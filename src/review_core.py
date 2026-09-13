"""Shared review-core boundary for OSS action and managed review snapshot builders."""

from __future__ import annotations

import base64
import binascii
from dataclasses import dataclass
import hashlib
from html.parser import HTMLParser
import json
import re
import struct
from typing import Any, Dict, List, Literal, Optional, Protocol, Sequence, Union

from .diff_engine import (
    CellChange,
    CellLocator,
    ContextCell,
    DiffLimits,
    NotebookDiff,
    NotebookFileDiff,
    NotebookInput,
    ReviewResult,
    build_notebook_diff,
)


SnapshotBlockKind = Literal["source", "outputs", "metadata"]
REVIEW_SNAPSHOT_SCHEMA_VERSION = 1
_SNAPSHOT_BLOCK_KINDS: Sequence[SnapshotBlockKind] = ("source", "outputs", "metadata")
ReviewAssetMimeType = Literal["image/png", "image/jpeg", "image/gif"]
OutputItemChangeType = Literal["added", "removed", "modified"]
OutputItemSide = Literal["base", "head"]
_REVIEW_ASSET_ALLOWED_MIME_TYPES: Sequence[ReviewAssetMimeType] = (
    "image/png",
    "image/jpeg",
    "image/gif",
)
_REVIEW_ASSET_MAX_BYTES = 2_097_152

# Bounded rich-output limits. Text/HTML are bounded via truncation (with an
# explicit `truncated` flag); interactive specs (Plotly/widget) are never
# truncated into broken data, they are rejected as a visible placeholder
# instead once they exceed these bounds or fail structural validation.
_RICH_TEXT_MAX_CHARS = 200_000
_RICH_HTML_MAX_CHARS = 200_000
_INTERACTIVE_SPEC_MAX_BYTES = 2_097_152

_PLOTLY_MIME_TYPE = "application/vnd.plotly.v1+json"
_WIDGET_VIEW_MIME_TYPE = "application/vnd.jupyter.widget-view+json"
_WIDGET_STATE_MIME_TYPE = "application/vnd.jupyter.widget-state+json"
_WIDGET_MODEL_REF_PREFIX = "IPY_MODEL_"
# Standard ipywidgets modules whose saved state we know how to embed safely.
# Anything else is an explicit, visible "custom module" placeholder rather
# than a silent best-effort render.
_STANDARD_WIDGET_MODULES: Sequence[str] = (
    "@jupyter-widgets/base",
    "@jupyter-widgets/controls",
)


@dataclass(frozen=True)
class ReviewAssetDraft:
    """Extracted image asset awaiting snapshot-scoped persistence."""

    asset_key: str
    sha256: str
    mime_type: ReviewAssetMimeType
    byte_size: int
    width: int | None
    height: int | None
    content_bytes: bytes


@dataclass(frozen=True)
class _SnapshotCellContent:
    outputs: Sequence[Dict[str, Any]]


@dataclass(frozen=True)
class _WidgetManagerState:
    """Parsed `application/vnd.jupyter.widget-state+json` notebook metadata."""

    version_major: int
    version_minor: int
    models: Dict[str, Dict[str, Any]]


_EMPTY_WIDGET_MANAGER_STATE = _WidgetManagerState(version_major=2, version_minor=0, models={})


@dataclass(frozen=True)
class _SnapshotNotebookContent:
    base_cells: Sequence[_SnapshotCellContent]
    head_cells: Sequence[_SnapshotCellContent]
    base_widget_state: _WidgetManagerState
    head_widget_state: _WidgetManagerState


class ReviewCoreReviewer(Protocol):
    """Minimal reviewer contract shared by OSS and managed review flows."""

    def review(self, diff: NotebookDiff) -> ReviewResult:
        """Return structured review output for a notebook diff."""


@dataclass(frozen=True)
class ReviewCoreRequest:
    """Shared review-core input used by both the Action and managed services."""

    notebook_inputs: Sequence[NotebookInput]
    reviewer: ReviewCoreReviewer
    limits: DiffLimits = DiffLimits()
    snapshot_schema_version: int = REVIEW_SNAPSHOT_SCHEMA_VERSION


@dataclass(frozen=True)
class ReviewArtifacts:
    """Structured review outputs reusable by multiple runtime surfaces."""

    notebook_diff: NotebookDiff
    review_result: ReviewResult
    snapshot_payload: Dict[str, Any]
    review_assets: Sequence[ReviewAssetDraft]


def build_review_artifacts(request: ReviewCoreRequest) -> ReviewArtifacts:
    """Build reusable diff, review result, and normalized snapshot payload."""
    notebook_diff = build_notebook_diff(request.notebook_inputs, limits=request.limits)
    review_result = request.reviewer.review(notebook_diff)
    snapshot_payload, review_assets = _build_review_snapshot_payload(
        notebook_diff,
        schema_version=request.snapshot_schema_version,
        notebook_inputs=request.notebook_inputs,
    )
    return ReviewArtifacts(
        notebook_diff=notebook_diff,
        review_result=review_result,
        snapshot_payload=snapshot_payload,
        review_assets=review_assets,
    )


def build_review_snapshot_payload(
    notebook_diff: NotebookDiff,
    *,
    schema_version: int = REVIEW_SNAPSHOT_SCHEMA_VERSION,
    notebook_inputs: Sequence[NotebookInput] = (),
) -> Dict[str, Any]:
    """Build the versioned normalized review snapshot payload for hosted rendering."""
    snapshot_payload, _review_assets = _build_review_snapshot_payload(
        notebook_diff,
        schema_version=schema_version,
        notebook_inputs=notebook_inputs,
    )
    return snapshot_payload


def _build_review_snapshot_payload(
    notebook_diff: NotebookDiff,
    *,
    schema_version: int,
    notebook_inputs: Sequence[NotebookInput],
) -> tuple[Dict[str, Any], Sequence[ReviewAssetDraft]]:
    if schema_version != REVIEW_SNAPSHOT_SCHEMA_VERSION:
        raise ValueError(
            f"Unsupported review snapshot schema version: {schema_version}"
        )

    snapshot_content_by_path = _snapshot_content_by_path(notebook_inputs)
    review_assets_by_key: Dict[str, ReviewAssetDraft] = {}
    snapshot_payload = {
        "schema_version": schema_version,
        "review": {
            "notices": list(notebook_diff.notices),
            "notebooks": [
                _notebook_snapshot(
                    notebook,
                    snapshot_content=snapshot_content_by_path.get(notebook.path),
                    review_assets_by_key=review_assets_by_key,
                )
                for notebook in notebook_diff.notebooks
            ],
        },
    }
    return snapshot_payload, tuple(review_assets_by_key.values())


def _notebook_snapshot(
    notebook: NotebookFileDiff,
    *,
    snapshot_content: _SnapshotNotebookContent | None,
    review_assets_by_key: Dict[str, ReviewAssetDraft],
) -> Dict[str, Any]:
    return {
        "path": notebook.path,
        "change_type": notebook.change_type,
        "notices": list(notebook.notices),
        "render_rows": [
            _render_row(
                notebook.path,
                change,
                snapshot_content=snapshot_content,
                review_assets_by_key=review_assets_by_key,
            )
            for change in notebook.cell_changes
        ],
    }


def _render_row(
    notebook_path: str,
    change: CellChange,
    *,
    snapshot_content: _SnapshotNotebookContent | None,
    review_assets_by_key: Dict[str, ReviewAssetDraft],
) -> Dict[str, Any]:
    return {
        "locator": _locator_dict(change.locator),
        "cell_type": change.cell_type,
        "change_type": change.change_type,
        "summary": change.summary,
        "source": {
            "base": change.base_source,
            "head": change.head_source,
            "changed": change.source_changed,
        },
        "outputs": {
            "changed": change.outputs_changed,
            "items": _render_output_items(
                change,
                snapshot_content=snapshot_content,
                review_assets_by_key=review_assets_by_key,
            ),
        },
        "metadata": {
            "changed": change.material_metadata_changed,
            "summary": change.metadata_summary,
        },
        "review_context": [_review_context_item(context) for context in change.review_context],
        "thread_anchors": {
            block_kind: _thread_anchor(
                notebook_path=notebook_path,
                change=change,
                block_kind=block_kind,
            )
            for block_kind in _SNAPSHOT_BLOCK_KINDS
        },
    }


def _thread_anchor(
    *,
    notebook_path: str,
    change: CellChange,
    block_kind: SnapshotBlockKind,
) -> Dict[str, Any]:
    return {
        "notebook_path": notebook_path,
        "cell_locator": _locator_dict(change.locator),
        "block_kind": block_kind,
        "source_fingerprint": _source_fingerprint(change),
        "cell_type": change.cell_type,
    }


def _locator_dict(locator: CellLocator) -> Dict[str, Optional[Union[int, str]]]:
    return {
        "cell_id": locator.cell_id,
        "base_index": locator.base_index,
        "head_index": locator.head_index,
        "display_index": locator.display_index,
    }


def _review_context_item(context: ContextCell) -> Dict[str, str]:
    return {
        "relative_position": context.relative_position,
        "cell_type": context.cell_type,
        "summary": context.summary,
    }


def _source_fingerprint(change: CellChange) -> str:
    source_text = change.head_source if change.head_source is not None else change.base_source
    normalized = _normalize_fingerprint_text(source_text or change.summary)
    payload = f"{change.cell_type}\0{normalized}".encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def _normalize_fingerprint_text(value: str) -> str:
    return "\n".join(line.rstrip() for line in value.replace("\r", "").split("\n")).strip()


def _snapshot_content_by_path(
    notebook_inputs: Sequence[NotebookInput],
) -> Dict[str, _SnapshotNotebookContent]:
    return {
        notebook_input.path: _SnapshotNotebookContent(
            base_cells=_parse_snapshot_cells(notebook_input.base_content),
            head_cells=_parse_snapshot_cells(notebook_input.head_content),
            base_widget_state=_parse_snapshot_widget_state(notebook_input.base_content),
            head_widget_state=_parse_snapshot_widget_state(notebook_input.head_content),
        )
        for notebook_input in notebook_inputs
    }


def _load_snapshot_notebook_json(content: str | None) -> Dict[str, Any] | None:
    if content is None:
        return None
    try:
        payload = json.loads(content)
    except json.JSONDecodeError:
        return None
    return payload if isinstance(payload, dict) else None


def _parse_snapshot_cells(content: str | None) -> Sequence[_SnapshotCellContent]:
    payload = _load_snapshot_notebook_json(content)
    if payload is None:
        return ()
    raw_cells = payload.get("cells")
    if not isinstance(raw_cells, list):
        return ()
    cells: List[_SnapshotCellContent] = []
    for raw_cell in raw_cells:
        if not isinstance(raw_cell, dict):
            continue
        cells.append(
            _SnapshotCellContent(
                outputs=_normalize_snapshot_outputs(raw_cell.get("outputs"))
            )
        )
    return tuple(cells)


def _parse_snapshot_widget_state(content: str | None) -> _WidgetManagerState:
    payload = _load_snapshot_notebook_json(content)
    if payload is None:
        return _EMPTY_WIDGET_MANAGER_STATE
    notebook_metadata = payload.get("metadata")
    if not isinstance(notebook_metadata, dict):
        return _EMPTY_WIDGET_MANAGER_STATE
    widgets_metadata = notebook_metadata.get("widgets")
    if not isinstance(widgets_metadata, dict):
        return _EMPTY_WIDGET_MANAGER_STATE
    manager_state = widgets_metadata.get(_WIDGET_STATE_MIME_TYPE)
    if not isinstance(manager_state, dict):
        return _EMPTY_WIDGET_MANAGER_STATE
    raw_models = manager_state.get("state")
    if not isinstance(raw_models, dict):
        return _EMPTY_WIDGET_MANAGER_STATE
    models: Dict[str, Dict[str, Any]] = {
        str(model_id): model_entry
        for model_id, model_entry in raw_models.items()
        if isinstance(model_id, str) and isinstance(model_entry, dict)
    }
    version_major = manager_state.get("version_major")
    version_minor = manager_state.get("version_minor")
    return _WidgetManagerState(
        version_major=version_major if isinstance(version_major, int) else 2,
        version_minor=version_minor if isinstance(version_minor, int) else 0,
        models=models,
    )


def _normalize_snapshot_outputs(outputs: Any) -> Sequence[Dict[str, Any]]:
    if not isinstance(outputs, list):
        return ()
    normalized: List[Dict[str, Any]] = []
    for raw_output in outputs:
        if not isinstance(raw_output, dict):
            continue
        normalized_output: Dict[str, Any] = {}
        for key, value in raw_output.items():
            if key in {"execution_count", "metadata"}:
                continue
            normalized_output[str(key)] = _stable_jsonable(value)
        normalized.append(normalized_output)
    return tuple(normalized)


def _stable_jsonable(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): _stable_jsonable(val) for key, val in sorted(value.items())}
    if isinstance(value, list):
        return [_stable_jsonable(item) for item in value]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


def _render_output_items(
    change: CellChange,
    *,
    snapshot_content: _SnapshotNotebookContent | None,
    review_assets_by_key: Dict[str, ReviewAssetDraft],
) -> List[Dict[str, Any]]:
    if snapshot_content is None:
        return _fallback_output_items(change)

    base_outputs = _outputs_for_index(snapshot_content.base_cells, change.locator.base_index)
    head_outputs = _outputs_for_index(snapshot_content.head_cells, change.locator.head_index)
    sources = _select_output_render_sources(
        base_outputs=base_outputs,
        head_outputs=head_outputs,
        base_widget_state=snapshot_content.base_widget_state,
        head_widget_state=snapshot_content.head_widget_state,
    )
    if not sources:
        return _fallback_output_items(change)

    items: List[Dict[str, Any]] = []
    for outputs, source_side, label_side, output_change_type in sources:
        widget_state = (
            snapshot_content.base_widget_state
            if source_side == "base"
            else snapshot_content.head_widget_state
        )
        for output in outputs:
            items.append(
                _render_single_output_item(
                    output,
                    change_type=output_change_type,
                    side=label_side,
                    review_assets_by_key=review_assets_by_key,
                    widget_state=widget_state,
                )
            )
    return items or _fallback_output_items(change)


def _outputs_for_index(
    cells: Sequence[_SnapshotCellContent],
    index: int | None,
) -> Sequence[Dict[str, Any]]:
    if index is None or index < 0 or index >= len(cells):
        return ()
    return cells[index].outputs


def _select_output_render_sources(
    *,
    base_outputs: Sequence[Dict[str, Any]],
    head_outputs: Sequence[Dict[str, Any]],
    base_widget_state: _WidgetManagerState,
    head_widget_state: _WidgetManagerState,
) -> List[
    tuple[
        Sequence[Dict[str, Any]],
        OutputItemSide,
        Optional[OutputItemSide],
        OutputItemChangeType,
    ]
]:
    """Choose which side(s) of a cell's outputs to render.

    Each entry is `(outputs, source_side, label_side, change_type)`:
    `source_side` always identifies which side's notebook metadata backs the
    outputs (for widget state lookup); `label_side` is the optional `side`
    field attached to the rendered item.

    Single-sided (only one side has output content, or both sides have
    identical content) keeps the legacy shape: exactly one render source and
    no `side` label, so existing snapshot payloads and consumers relying on
    the old single-item shape keep working unchanged.

    When both sides have differing output content, both are rendered as an
    explicit before/after pair labeled by `side` so reviewers can see what
    changed. The head-side entry keeps the legacy `"modified"` change type
    (mirroring the previous single-item behavior) while the base-side entry
    is labeled `"removed"` to represent the prior content.

    A widget-view output's raw JSON only carries a `model_id` reference; the
    actual interactive state lives in each side's own notebook metadata. So
    "identical content" is judged on the *resolved* widget state, not just
    raw output equality: a saved-state-only edit (same model_id reference,
    changed slider value, etc., including edits to a transitively-referenced
    model) still renders as a before/after pair even though `base_outputs ==
    head_outputs`.
    """
    if head_outputs and not base_outputs:
        return [(head_outputs, "head", None, "added")]
    if base_outputs and not head_outputs:
        return [(base_outputs, "base", None, "removed")]
    if head_outputs and base_outputs:
        if _outputs_effectively_equal(
            base_outputs,
            head_outputs,
            base_widget_state=base_widget_state,
            head_widget_state=head_widget_state,
        ):
            return [(head_outputs, "head", None, "modified")]
        return [
            (head_outputs, "head", "head", "modified"),
            (base_outputs, "base", "base", "removed"),
        ]
    return []


def _outputs_effectively_equal(
    base_outputs: Sequence[Dict[str, Any]],
    head_outputs: Sequence[Dict[str, Any]],
    *,
    base_widget_state: _WidgetManagerState,
    head_widget_state: _WidgetManagerState,
) -> bool:
    if base_outputs != head_outputs:
        return False
    # Raw output JSON is identical; still check whether any widget-view
    # output's resolved saved state differs between sides.
    for output in head_outputs:
        data = output.get("data")
        if not isinstance(data, dict):
            continue
        raw_view = data.get(_WIDGET_VIEW_MIME_TYPE)
        model_id = raw_view.get("model_id") if isinstance(raw_view, dict) else None
        if not isinstance(model_id, str) or not model_id:
            continue
        base_resolved, base_error = _resolve_widget_models(model_id, base_widget_state)
        head_resolved, head_error = _resolve_widget_models(model_id, head_widget_state)
        if (base_resolved, base_error) != (head_resolved, head_error):
            return False
    return True


def _with_side(item: Dict[str, Any], side: OutputItemSide | None) -> Dict[str, Any]:
    if side is None:
        return item
    return {**item, "side": side}


def _render_single_output_item(
    output: Dict[str, Any],
    *,
    change_type: OutputItemChangeType,
    side: OutputItemSide | None,
    review_assets_by_key: Dict[str, ReviewAssetDraft],
    widget_state: _WidgetManagerState,
) -> Dict[str, Any]:
    output_type = _normalize_output_type(output.get("output_type"))

    if output_type in {"stream", "error"}:
        return _build_stream_or_error_output_item(
            output,
            output_type=output_type,
            change_type=change_type,
            side=side,
        )

    data = output.get("data")
    if isinstance(data, dict):
        # Prefer interactive/rendered representations over the static image
        # fallback that authoring tools frequently embed alongside them.
        plotly_item = _build_plotly_output_item(
            data,
            output_type=output_type,
            change_type=change_type,
            side=side,
        )
        if plotly_item is not None:
            return plotly_item

        widget_item = _build_widget_output_item(
            data,
            output_type=output_type,
            change_type=change_type,
            side=side,
            widget_state=widget_state,
        )
        if widget_item is not None:
            return widget_item

        html_item = _build_html_output_item(
            data,
            change_type=change_type,
            side=side,
        )
        if html_item is not None:
            return html_item

    image_payload = _build_image_output_item(
        output,
        change_type=change_type,
        review_assets_by_key=review_assets_by_key,
    )
    if image_payload is not None:
        return _with_side(image_payload, side)

    if isinstance(data, dict):
        text_item = _build_generic_text_output_item(
            data,
            change_type=change_type,
            side=side,
        )
        if text_item is not None:
            return text_item

    raw_size = _output_text_size(output)
    mime_group = _infer_mime_group(output_type, output)
    return _with_side(
        {
            "kind": "placeholder",
            "output_type": output_type,
            "mime_group": mime_group,
            "summary": _output_summary(output_type, mime_group, raw_size),
            "truncated": False,
            "change_type": change_type,
        },
        side,
    )


def _bound_text(text: str, max_chars: int) -> tuple[str, bool]:
    if len(text) <= max_chars:
        return text, False
    return text[:max_chars], True


def _joined_text_field(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return "".join(part for part in value if isinstance(part, str))
    return ""


def _error_output_text(output: Dict[str, Any]) -> str:
    traceback = output.get("traceback")
    if isinstance(traceback, list) and traceback:
        return "\n".join(line for line in traceback if isinstance(line, str))
    parts = [str(part) for part in (output.get("ename"), output.get("evalue")) if part]
    return ": ".join(parts)


def _build_stream_or_error_output_item(
    output: Dict[str, Any],
    *,
    output_type: str,
    change_type: OutputItemChangeType,
    side: OutputItemSide | None,
) -> Dict[str, Any]:
    full_text = _error_output_text(output) if output_type == "error" else _joined_text_field(output.get("text"))
    bounded_text, truncated = _bound_text(full_text, _RICH_TEXT_MAX_CHARS)
    return _with_side(
        {
            "kind": "text",
            "text": bounded_text,
            "mime_type": output_type,
            "summary": _output_summary(output_type, "text", len(full_text)),
            "truncated": truncated,
            "change_type": change_type,
        },
        side,
    )


def _build_generic_text_output_item(
    data: Dict[str, Any],
    *,
    change_type: OutputItemChangeType,
    side: OutputItemSide | None,
) -> Dict[str, Any] | None:
    if "text/plain" in data:
        raw_text = _normalize_mime_payload(data.get("text/plain"))
        if raw_text is None:
            return None
        bounded_text, truncated = _bound_text(raw_text, _RICH_TEXT_MAX_CHARS)
        return _with_side(
            {
                "kind": "text",
                "text": bounded_text,
                "mime_type": "text/plain",
                "summary": f"text output updated ({len(raw_text)} chars)",
                "truncated": truncated,
                "change_type": change_type,
            },
            side,
        )

    json_mime_type = next(
        (
            key
            for key in data.keys()
            if key not in {_PLOTLY_MIME_TYPE, _WIDGET_VIEW_MIME_TYPE}
            and (key == "application/json" or key.endswith("+json"))
        ),
        None,
    )
    if json_mime_type is None:
        return None
    try:
        serialized = json.dumps(data.get(json_mime_type), indent=2, sort_keys=True)
    except (TypeError, ValueError):
        return None
    bounded_text, truncated = _bound_text(serialized, _RICH_TEXT_MAX_CHARS)
    return _with_side(
        {
            "kind": "text",
            "text": bounded_text,
            "mime_type": json_mime_type,
            "summary": f"JSON output updated ({len(serialized)} chars)",
            "truncated": truncated,
            "change_type": change_type,
        },
        side,
    )


def _build_html_output_item(
    data: Dict[str, Any],
    *,
    change_type: OutputItemChangeType,
    side: OutputItemSide | None,
) -> Dict[str, Any] | None:
    if "text/html" not in data:
        return None
    raw_html = _normalize_mime_payload(data.get("text/html"))
    if raw_html is None:
        return None
    bounded_html, truncated = _bound_text(raw_html, _RICH_HTML_MAX_CHARS)
    return _with_side(
        {
            "kind": "html",
            "html": bounded_html,
            "summary": f"HTML output updated ({len(raw_html)} chars)",
            "truncated": truncated,
            "change_type": change_type,
        },
        side,
    )


def _validate_plotly_spec(raw_spec: Any) -> Dict[str, Any] | None:
    if not isinstance(raw_spec, dict):
        return None
    raw_data = raw_spec.get("data")
    if not isinstance(raw_data, list) or not all(isinstance(trace, dict) for trace in raw_data):
        return None
    spec: Dict[str, Any] = {"data": raw_data}
    layout = raw_spec.get("layout")
    if isinstance(layout, dict):
        spec["layout"] = layout
    config = raw_spec.get("config")
    if isinstance(config, dict):
        spec["config"] = config
    return spec


class _SavedPlotlyScripts(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=False)
        self.in_script = False
        self.scripts: List[str] = []

    def handle_starttag(self, tag: str, attrs: Any) -> None:
        self.in_script = tag == "script"

    def handle_endtag(self, tag: str) -> None:
        if tag == "script":
            self.in_script = False

    def handle_data(self, data: str) -> None:
        if self.in_script:
            self.scripts.append(data)


def _plotly_spec_from_html(raw_html: Any) -> Dict[str, Any] | None:
    """Recover saved JSON arguments, never evaluate notebook JavaScript.

    Plotly's HTML renderer saves a newPlot call instead of the Plotly MIME.
    Only one literal-data figure is supported; dynamic expressions and frame
    scripts must not silently become an incomplete static chart.
    """
    if isinstance(raw_html, list) and all(isinstance(part, str) for part in raw_html):
        raw_html = "".join(raw_html)
    if not isinstance(raw_html, str) or "Plotly.newPlot" not in raw_html:
        return None
    # Exported HTML may include the bundled library (>5 MB). Bound parsing
    # separately from the much smaller extracted data limit below.
    if len(raw_html) > 8_388_608:
        return {}
    parser = _SavedPlotlyScripts()
    parser.feed(raw_html)
    raw_html = "\n".join(parser.scripts)
    if "Plotly.newPlot" not in raw_html:
        return None
    calls = list(re.finditer(r"\bPlotly\.newPlot\s*\(", raw_html))
    if len(calls) != 1 or re.search(r"\bPlotly\.(?:addFrames|animate|react|restyle|relayout)\s*\(", raw_html):
        return {}

    def reject_constant(value: str) -> Any:
        raise ValueError("Non-JSON numeric constant")

    decoder = json.JSONDecoder(parse_constant=reject_constant)
    position = calls[0].end()
    arguments: List[Any] = []
    try:
        for index in range(4):
            while position < len(raw_html) and raw_html[position].isspace():
                position += 1
            value, position = decoder.raw_decode(raw_html, position)
            arguments.append(value)
            while position < len(raw_html) and raw_html[position].isspace():
                position += 1
            expected = ")" if index == 3 else ","
            if raw_html[position:position + 1] != expected:
                return {}
            position += 1
    except (ValueError, RecursionError):
        return {}
    if not isinstance(arguments[0], str) or not isinstance(arguments[2], dict) or not isinstance(arguments[3], dict):
        return {}
    return {"data": arguments[1], "layout": arguments[2], "config": arguments[3]}


def _build_plotly_output_item(
    data: Dict[str, Any],
    *,
    output_type: str,
    change_type: OutputItemChangeType,
    side: OutputItemSide | None,
) -> Dict[str, Any] | None:
    from_html = _PLOTLY_MIME_TYPE not in data
    raw_spec = data.get(_PLOTLY_MIME_TYPE) if not from_html else _plotly_spec_from_html(data.get("text/html"))
    if from_html and raw_spec is None:
        return None

    if isinstance(raw_spec, dict) and "frames" in raw_spec and raw_spec["frames"] != []:
        return _with_side(
            _interactive_placeholder(
                output_type=output_type,
                mime_group="plotly",
                change_type=change_type,
                reason="animation frames are not supported; save a static Plotly figure for review",
            ),
            side,
        )

    validated_spec = _validate_plotly_spec(raw_spec)
    if validated_spec is None:
        return _with_side(
            _interactive_placeholder(
                output_type=output_type,
                mime_group="plotly",
                change_type=change_type,
                reason="unsupported HTML chart script; save Plotly JSON output" if from_html else "malformed plot data",
            ),
            side,
        )

    serialized_size = len(json.dumps(validated_spec))
    if serialized_size > _INTERACTIVE_SPEC_MAX_BYTES:
        return _with_side(
            _interactive_placeholder(
                output_type=output_type,
                mime_group="plotly",
                change_type=change_type,
                reason=f"{serialized_size} bytes exceeds {_INTERACTIVE_SPEC_MAX_BYTES} bytes",
            ),
            side,
        )

    return _with_side(
        {
            "kind": "plotly",
            "spec": validated_spec,
            "summary": "Saved Plotly data; custom JavaScript is not executed" if from_html else "Plotly output updated",
            "truncated": False,
            "change_type": change_type,
        },
        side,
    )


def _interactive_placeholder(
    *,
    output_type: str,
    mime_group: str,
    change_type: OutputItemChangeType,
    reason: str,
) -> Dict[str, Any]:
    label = "Plotly" if mime_group == "plotly" else "Widget"
    return {
        "kind": "placeholder",
        "output_type": output_type,
        "mime_group": mime_group,
        "summary": f"{label} output kept as placeholder ({reason})",
        "truncated": False,
        "change_type": change_type,
    }


def _referenced_widget_model_ids(value: Any) -> List[str]:
    ids: List[str] = []
    if isinstance(value, str):
        if value.startswith(_WIDGET_MODEL_REF_PREFIX):
            ids.append(value[len(_WIDGET_MODEL_REF_PREFIX) :])
    elif isinstance(value, dict):
        for nested in value.values():
            ids.extend(_referenced_widget_model_ids(nested))
    elif isinstance(value, list):
        for nested in value:
            ids.extend(_referenced_widget_model_ids(nested))
    return ids


# The envelope's `model_module` is what a shallow allowlist check covers, but
# @jupyter-widgets' own base-manager reads the *model's own saved attributes*
# (`_model_module`/`_view_module`, inside the model's `state`, not the
# envelope) to decide which JS module to instantiate for construction and for
# the view. A payload could pass an allowed envelope while smuggling a
# hostile module reference in these inner fields, so they must be validated
# too, not just the envelope -- mirrors the frontend's
# `validateWidgetPayload` in `apps/web/lib/interactive-output.ts`.
_INNER_WIDGET_MODULE_FIELDS: Sequence[str] = ("_model_module", "_view_module")


def _resolve_widget_models(
    root_model_id: str,
    widget_state: _WidgetManagerState,
) -> tuple[Dict[str, Dict[str, Any]] | None, str | None]:
    if not widget_state.models:
        return None, "missing saved widget state"

    resolved: Dict[str, Dict[str, Any]] = {}
    pending = [root_model_id]
    seen: set[str] = set()
    while pending:
        current_id = pending.pop()
        if current_id in seen:
            continue
        seen.add(current_id)
        entry = widget_state.models.get(current_id)
        if entry is None:
            return None, f"missing saved widget state for model {current_id}"
        model_module = entry.get("model_module")
        if model_module not in _STANDARD_WIDGET_MODULES:
            return None, f"custom widget module '{model_module}' is not supported"
        model_state = entry.get("state")
        if isinstance(model_state, dict):
            for inner_field in _INNER_WIDGET_MODULE_FIELDS:
                if inner_field not in model_state:
                    continue
                inner_module = model_state[inner_field]
                if inner_module not in _STANDARD_WIDGET_MODULES:
                    return None, f"custom widget module '{inner_module}' is not supported"
        resolved[current_id] = entry
        pending.extend(_referenced_widget_model_ids(entry.get("state")))
    return resolved, None


def _build_widget_output_item(
    data: Dict[str, Any],
    *,
    output_type: str,
    change_type: OutputItemChangeType,
    side: OutputItemSide | None,
    widget_state: _WidgetManagerState,
) -> Dict[str, Any] | None:
    if _WIDGET_VIEW_MIME_TYPE not in data:
        return None

    raw_view = data.get(_WIDGET_VIEW_MIME_TYPE)
    model_id = raw_view.get("model_id") if isinstance(raw_view, dict) else None
    if not isinstance(model_id, str) or not model_id:
        return _with_side(
            _interactive_placeholder(
                output_type=output_type,
                mime_group="widget",
                change_type=change_type,
                reason="malformed widget view reference",
            ),
            side,
        )

    resolved_models, error_reason = _resolve_widget_models(model_id, widget_state)
    if error_reason is not None:
        return _with_side(
            _interactive_placeholder(
                output_type=output_type,
                mime_group="widget",
                change_type=change_type,
                reason=error_reason,
            ),
            side,
        )

    view = {
        "version_major": raw_view.get("version_major", 2),
        "version_minor": raw_view.get("version_minor", 0),
        "model_id": model_id,
    }
    state = {
        "version_major": widget_state.version_major,
        "version_minor": widget_state.version_minor,
        "state": resolved_models,
    }

    serialized_size = len(json.dumps(state))
    if serialized_size > _INTERACTIVE_SPEC_MAX_BYTES:
        return _with_side(
            _interactive_placeholder(
                output_type=output_type,
                mime_group="widget",
                change_type=change_type,
                reason=f"{serialized_size} bytes exceeds {_INTERACTIVE_SPEC_MAX_BYTES} bytes",
            ),
            side,
        )

    return _with_side(
        {
            "kind": "widget",
            "view": view,
            "state": state,
            "summary": "Saved widget output updated",
            "truncated": False,
            "change_type": change_type,
        },
        side,
    )


def _build_image_output_item(
    output: Dict[str, Any],
    *,
    change_type: OutputItemChangeType,
    review_assets_by_key: Dict[str, ReviewAssetDraft],
) -> Dict[str, Any] | None:
    image_candidate = _extract_image_candidate(output)
    if image_candidate is None:
        return None
    if image_candidate["status"] != "supported":
        return {
            "kind": "placeholder",
            "output_type": _normalize_output_type(output.get("output_type")),
            "mime_group": "image",
            "summary": image_candidate["summary"],
            "truncated": False,
            "change_type": change_type,
        }

    asset_draft = image_candidate["asset_draft"]
    review_assets_by_key.setdefault(asset_draft.asset_key, asset_draft)
    return {
        "kind": "image",
        "asset_key": asset_draft.asset_key,
        "mime_type": asset_draft.mime_type,
        "width": asset_draft.width,
        "height": asset_draft.height,
        "change_type": change_type,
    }


def _extract_image_candidate(output: Dict[str, Any]) -> Dict[str, Any] | None:
    data = output.get("data")
    if not isinstance(data, dict):
        return None

    image_keys = [str(key) for key in data.keys() if str(key).startswith("image/")]
    if not image_keys:
        return None

    supported_mime_type = next(
        (mime_type for mime_type in _REVIEW_ASSET_ALLOWED_MIME_TYPES if mime_type in data),
        None,
    )
    if supported_mime_type is None:
        unsupported_mime_type = sorted(image_keys)[0]
        return {
            "status": "placeholder",
            "summary": (
                f"{unsupported_mime_type} output kept as placeholder "
                "(unsupported image format)"
            ),
        }

    raw_payload = _normalize_mime_payload(data.get(supported_mime_type))
    if raw_payload is None or not raw_payload.strip():
        return {
            "status": "placeholder",
            "summary": (
                f"{supported_mime_type} output kept as placeholder "
                "(invalid image data)"
            ),
        }

    try:
        content_bytes = base64.b64decode(_normalize_base64(raw_payload), validate=False)
    except (ValueError, binascii.Error):
        return {
            "status": "placeholder",
            "summary": (
                f"{supported_mime_type} output kept as placeholder "
                "(invalid image data)"
            ),
        }

    byte_size = len(content_bytes)
    if byte_size > _REVIEW_ASSET_MAX_BYTES:
        return {
            "status": "placeholder",
            "summary": (
                f"{supported_mime_type} output kept as placeholder "
                f"({byte_size} bytes exceeds {_REVIEW_ASSET_MAX_BYTES} bytes)"
            ),
        }

    width, height = _image_dimensions(supported_mime_type, content_bytes)
    sha256 = hashlib.sha256(content_bytes).hexdigest()
    return {
        "status": "supported",
        "asset_draft": ReviewAssetDraft(
            asset_key=f"sha256:{sha256}",
            sha256=sha256,
            mime_type=supported_mime_type,
            byte_size=byte_size,
            width=width,
            height=height,
            content_bytes=content_bytes,
        ),
    }


def _normalize_mime_payload(value: Any) -> str | None:
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        parts = [part for part in value if isinstance(part, str)]
        return "".join(parts)
    return None


def _normalize_base64(value: str) -> str:
    return "".join(value.split())


def _image_dimensions(
    mime_type: ReviewAssetMimeType,
    content_bytes: bytes,
) -> tuple[int | None, int | None]:
    try:
        if mime_type == "image/png":
            return _png_dimensions(content_bytes)
        if mime_type == "image/gif":
            return _gif_dimensions(content_bytes)
        if mime_type == "image/jpeg":
            return _jpeg_dimensions(content_bytes)
    except ValueError:
        return None, None
    return None, None


def _png_dimensions(content_bytes: bytes) -> tuple[int, int]:
    if len(content_bytes) < 24 or content_bytes[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("invalid png header")
    return struct.unpack(">II", content_bytes[16:24])


def _gif_dimensions(content_bytes: bytes) -> tuple[int, int]:
    if len(content_bytes) < 10 or content_bytes[:6] not in {b"GIF87a", b"GIF89a"}:
        raise ValueError("invalid gif header")
    return struct.unpack("<HH", content_bytes[6:10])


def _jpeg_dimensions(content_bytes: bytes) -> tuple[int, int]:
    if len(content_bytes) < 4 or content_bytes[:2] != b"\xff\xd8":
        raise ValueError("invalid jpeg header")
    offset = 2
    while offset + 9 < len(content_bytes):
        if content_bytes[offset] != 0xFF:
            offset += 1
            continue
        marker = content_bytes[offset + 1]
        offset += 2
        if marker in {0xD8, 0xD9}:
            continue
        if offset + 2 > len(content_bytes):
            break
        segment_length = struct.unpack(">H", content_bytes[offset : offset + 2])[0]
        if segment_length < 2 or offset + segment_length > len(content_bytes):
            break
        if marker in {
            0xC0,
            0xC1,
            0xC2,
            0xC3,
            0xC5,
            0xC6,
            0xC7,
            0xC9,
            0xCA,
            0xCB,
            0xCD,
            0xCE,
            0xCF,
        }:
            if offset + 7 > len(content_bytes):
                break
            height, width = struct.unpack(">HH", content_bytes[offset + 3 : offset + 7])
            return width, height
        offset += segment_length
    raise ValueError("missing jpeg dimensions")


def _fallback_output_items(change: CellChange) -> List[Dict[str, Any]]:
    change_type: OutputItemChangeType = "modified"
    if change.change_type == "added":
        change_type = "added"
    elif change.change_type == "deleted":
        change_type = "removed"
    return [
        {
            "kind": "placeholder",
            "output_type": output.output_type,
            "mime_group": output.mime_group,
            "summary": output.summary,
            "truncated": output.truncated,
            "change_type": change_type,
        }
        for output in change.output_changes
    ]


def _normalize_output_type(raw_output_type: Any) -> str:
    if raw_output_type in {"stream", "error", "display_data", "execute_result"}:
        return str(raw_output_type)
    return "display_data"


def _infer_mime_group(output_type: str, output: Dict[str, Any]) -> str:
    if output_type in {"stream", "error"}:
        return "text"

    data = output.get("data")
    if not isinstance(data, dict):
        return "unknown"

    mime_keys = {str(key) for key in data.keys()}
    if any(key.startswith("image/") for key in mime_keys):
        return "image"
    if "text/html" in mime_keys:
        return "html"
    if any(key.endswith("+json") or key == "application/json" for key in mime_keys):
        return "json"
    if "text/csv" in mime_keys or "application/vnd.dataresource+json" in mime_keys:
        return "table"
    if "text/plain" in mime_keys:
        return "text"
    return "unknown"


def _output_text_size(output: Dict[str, Any]) -> int:
    text_parts: List[str] = []
    for key in ("text", "evalue"):
        value = output.get(key)
        if isinstance(value, str):
            text_parts.append(value)
        elif isinstance(value, list):
            text_parts.extend(part for part in value if isinstance(part, str))

    traceback = output.get("traceback")
    if isinstance(traceback, list):
        text_parts.extend(line for line in traceback if isinstance(line, str))

    data = output.get("data")
    if isinstance(data, dict):
        for value in data.values():
            if isinstance(value, str):
                text_parts.append(value)
            elif isinstance(value, list):
                text_parts.extend(part for part in value if isinstance(part, str))
    return sum(len(part) for part in text_parts)


def _output_summary(output_type: str, mime_group: str, size: int) -> str:
    if output_type == "error":
        return f"error output updated ({size} chars)"
    if output_type == "stream":
        return f"text stream output updated ({size} chars)"
    return f"{mime_group} output updated ({size} chars)"


__all__ = [
    "REVIEW_SNAPSHOT_SCHEMA_VERSION",
    "ReviewAssetDraft",
    "ReviewArtifacts",
    "ReviewCoreRequest",
    "ReviewCoreReviewer",
    "SnapshotBlockKind",
    "build_review_artifacts",
    "build_review_snapshot_payload",
]
