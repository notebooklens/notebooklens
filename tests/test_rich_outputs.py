"""Phase 2 rich-output rendering contract: text/HTML/Plotly/widget items,
before/after `side` labeling, bounded/rejected interactive payloads, and
persisted asset-ref rewriting preserving `side`."""

from __future__ import annotations

import json
from typing import Any, Mapping, Sequence

from src.claude_integration import NoneProvider
from src.diff_engine import NotebookInput
from src.review_core import ReviewCoreRequest, build_review_artifacts

from apps.api.orchestration import _rewrite_snapshot_payload_asset_refs


_INTERACTIVE_SPEC_MAX_BYTES = 2_097_152


def _notebook_with_cells(
    cells: Sequence[Mapping[str, Any]],
    *,
    widget_state: Mapping[str, Any] | None = None,
) -> str:
    metadata: dict[str, Any] = {}
    if widget_state is not None:
        metadata["widgets"] = {
            "application/vnd.jupyter.widget-state+json": widget_state
        }
    return json.dumps(
        {
            "cells": list(cells),
            "metadata": metadata,
            "nbformat": 4,
            "nbformat_minor": 5,
        }
    )


def _code_cell(cell_id: str, *, outputs: Sequence[Mapping[str, Any]] | None = None) -> dict[str, Any]:
    return {
        "cell_type": "code",
        "id": cell_id,
        "source": "render()",
        "metadata": {},
        "outputs": list(outputs or []),
    }


def _widget_manager_state(models: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "version_major": 2,
        "version_minor": 0,
        "state": dict(models),
    }


def _widget_model(*, module: str = "@jupyter-widgets/controls", state: Mapping[str, Any] | None = None) -> dict[str, Any]:
    return {
        "model_name": "IntSliderModel",
        "model_module": module,
        "model_module_version": "2.0.0",
        "state": dict(state or {"value": 1}),
    }


def _widget_view(model_id: str) -> dict[str, Any]:
    return {"version_major": 2, "version_minor": 0, "model_id": model_id}


def _build_snapshot(
    *,
    base_cells: Sequence[Mapping[str, Any]],
    head_cells: Sequence[Mapping[str, Any]],
    base_widget_state: Mapping[str, Any] | None = None,
    head_widget_state: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    artifacts = build_review_artifacts(
        ReviewCoreRequest(
            notebook_inputs=[
                NotebookInput(
                    path="analysis/rich.ipynb",
                    change_type="modified",
                    base_content=_notebook_with_cells(base_cells, widget_state=base_widget_state),
                    head_content=_notebook_with_cells(head_cells, widget_state=head_widget_state),
                )
            ],
            reviewer=NoneProvider(),
        )
    )
    return artifacts.snapshot_payload


def _rows_by_cell_id(snapshot_payload: Mapping[str, Any]) -> dict[str, Any]:
    notebook = snapshot_payload["review"]["notebooks"][0]
    return {row["locator"]["cell_id"]: row for row in notebook["render_rows"]}


def _items(row: Mapping[str, Any]) -> list[dict[str, Any]]:
    return row["outputs"]["items"]


# ---------------------------------------------------------------------------
# text (stream/error/plain/JSON)
# ---------------------------------------------------------------------------


def test_stream_output_renders_as_bounded_text_item() -> None:
    payload = _build_snapshot(
        base_cells=[_code_cell("stream-cell")],
        head_cells=[
            _code_cell(
                "stream-cell",
                outputs=[{"output_type": "stream", "name": "stdout", "text": "hello world\n"}],
            )
        ],
    )
    item = _items(_rows_by_cell_id(payload)["stream-cell"])[0]
    assert item["kind"] == "text"
    assert item["text"] == "hello world\n"
    assert item["mime_type"] == "stream"
    assert item["truncated"] is False
    assert item["change_type"] == "added"
    assert "side" not in item


def test_error_output_renders_full_traceback_as_text() -> None:
    payload = _build_snapshot(
        base_cells=[_code_cell("error-cell")],
        head_cells=[
            _code_cell(
                "error-cell",
                outputs=[
                    {
                        "output_type": "error",
                        "ename": "ValueError",
                        "evalue": "bad input",
                        "traceback": ["Traceback (most recent call last):", "ValueError: bad input"],
                    }
                ],
            )
        ],
    )
    item = _items(_rows_by_cell_id(payload)["error-cell"])[0]
    assert item["kind"] == "text"
    assert item["mime_type"] == "error"
    assert "ValueError: bad input" in item["text"]
    assert item["truncated"] is False


def test_text_plain_and_json_outputs_render_as_text_items() -> None:
    payload = _build_snapshot(
        base_cells=[_code_cell("plain-cell"), _code_cell("json-cell")],
        head_cells=[
            _code_cell(
                "plain-cell",
                outputs=[
                    {
                        "output_type": "execute_result",
                        "data": {"text/plain": "42"},
                    }
                ],
            ),
            _code_cell(
                "json-cell",
                outputs=[
                    {
                        "output_type": "execute_result",
                        "data": {"application/json": {"accuracy": 0.9}},
                    }
                ],
            ),
        ],
    )
    rows = _rows_by_cell_id(payload)
    plain_item = _items(rows["plain-cell"])[0]
    assert plain_item["kind"] == "text"
    assert plain_item["mime_type"] == "text/plain"
    assert plain_item["text"] == "42"

    json_item = _items(rows["json-cell"])[0]
    assert json_item["kind"] == "text"
    assert json_item["mime_type"] == "application/json"
    assert json.loads(json_item["text"]) == {"accuracy": 0.9}


def test_text_output_beyond_bound_is_truncated_and_flagged() -> None:
    oversized_text = "x" * (200_000 + 500)
    payload = _build_snapshot(
        base_cells=[_code_cell("big-text")],
        head_cells=[
            _code_cell(
                "big-text",
                outputs=[{"output_type": "stream", "name": "stdout", "text": oversized_text}],
            )
        ],
    )
    item = _items(_rows_by_cell_id(payload)["big-text"])[0]
    assert item["kind"] == "text"
    assert item["truncated"] is True
    assert len(item["text"]) == 200_000


# ---------------------------------------------------------------------------
# html
# ---------------------------------------------------------------------------


def test_html_output_renders_as_bounded_html_item() -> None:
    payload = _build_snapshot(
        base_cells=[_code_cell("html-cell")],
        head_cells=[
            _code_cell(
                "html-cell",
                outputs=[
                    {
                        "output_type": "display_data",
                        "data": {"text/html": "<table><tr><td>1</td></tr></table>"},
                    }
                ],
            )
        ],
    )
    item = _items(_rows_by_cell_id(payload)["html-cell"])[0]
    assert item["kind"] == "html"
    assert item["html"] == "<table><tr><td>1</td></tr></table>"
    assert item["truncated"] is False
    assert item["change_type"] == "added"


def test_html_output_beyond_bound_is_truncated_and_flagged() -> None:
    oversized_html = "<p>" + ("a" * 200_000) + "</p>"
    payload = _build_snapshot(
        base_cells=[_code_cell("big-html")],
        head_cells=[
            _code_cell(
                "big-html",
                outputs=[{"output_type": "display_data", "data": {"text/html": oversized_html}}],
            )
        ],
    )
    item = _items(_rows_by_cell_id(payload)["big-html"])[0]
    assert item["kind"] == "html"
    assert item["truncated"] is True
    assert len(item["html"]) == 200_000


# ---------------------------------------------------------------------------
# plotly
# ---------------------------------------------------------------------------


def _plotly_output(spec: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "output_type": "display_data",
        "data": {"application/vnd.plotly.v1+json": spec},
    }


def test_plotly_output_renders_valid_spec() -> None:
    spec = {
        "data": [{"type": "scatter", "x": [1, 2], "y": [3, 4]}],
        "layout": {"title": "trend"},
        "config": {"displayModeBar": False},
    }
    payload = _build_snapshot(
        base_cells=[_code_cell("plot-cell")],
        head_cells=[_code_cell("plot-cell", outputs=[_plotly_output(spec)])],
    )
    item = _items(_rows_by_cell_id(payload)["plot-cell"])[0]
    assert item["kind"] == "plotly"
    assert item["spec"] == spec
    assert item["change_type"] == "added"


def test_plotly_output_preferred_over_static_image_fallback() -> None:
    spec = {"data": [{"type": "bar", "y": [1, 2, 3]}]}
    output = {
        "output_type": "display_data",
        "data": {
            "application/vnd.plotly.v1+json": spec,
            "image/png": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2N1foAAAAASUVORK5CYII=",
        },
    }
    payload = _build_snapshot(
        base_cells=[_code_cell("plot-fallback")],
        head_cells=[_code_cell("plot-fallback", outputs=[output])],
    )
    item = _items(_rows_by_cell_id(payload)["plot-fallback"])[0]
    assert item["kind"] == "plotly"
    assert item["spec"]["data"] == spec["data"]


def test_plotly_mime_frames_are_not_silently_discarded() -> None:
    for frames in [[{"name": "next", "data": [{"y": [2]}]}], None, {}, "invalid"]:
        payload = _build_snapshot(
            base_cells=[_code_cell("animated")],
            head_cells=[_code_cell("animated", outputs=[_plotly_output({
                "data": [{"type": "bar", "y": [1]}], "frames": frames,
            })])],
        )
        item = _items(_rows_by_cell_id(payload)["animated"])[0]
        assert item["kind"] == "placeholder"
        assert "save a static Plotly figure" in item["summary"]


def test_plotly_mime_empty_frames_preserve_static_rendering() -> None:
    payload = _build_snapshot(
        base_cells=[_code_cell("static")],
        head_cells=[_code_cell("static", outputs=[_plotly_output({
            "data": [{"type": "bar", "y": [1]}], "frames": [],
        })])],
    )
    item = _items(_rows_by_cell_id(payload)["static"])[0]
    assert item["kind"] == "plotly"
    assert item["spec"]["data"] == [{"type": "bar", "y": [1]}]


def _html_plot_item(html: Any) -> dict[str, Any]:
    payload = _build_snapshot(
        base_cells=[_code_cell("html-plot")],
        head_cells=[_code_cell("html-plot", outputs=[{
            "output_type": "display_data", "data": {"text/html": html},
        }])],
    )
    return _items(_rows_by_cell_id(payload)["html-plot"])[0]


def test_saved_plotly_html_extracts_literal_data_without_notebook_scripts() -> None:
    data = [{"type": "bar", "x": ["A", "B"], "y": [3, 7]}]
    layout = {"title": {"text": "Synthetic chart"}}
    config = {"responsive": True}
    html = '<div id="chart"></div><script>require(["plotly"], function(Plotly) { Plotly.newPlot(' + ", ".join(
        json.dumps(value) for value in ["chart", data, layout, config]
    ) + '); });</script>'
    item = _html_plot_item([html[:40], html[40:]])
    assert item["kind"] == "plotly"
    assert item["spec"] == {"data": data, "layout": layout, "config": config}
    assert "JavaScript is not executed" in item["summary"]
    assert "require" not in json.dumps(item)


def test_plotly_html_dynamic_multiple_animated_and_oversized_are_explicit_placeholders() -> None:
    for html in [
        '<script>Plotly.newPlot("chart", fetch("https://example.invalid"), {}, {});</script>',
        '<script>Plotly.newPlot("chart", [{"y":[NaN]}], {}, {});</script>',
        '<script>Plotly.newPlot("chart", [], {}, {}); Plotly.newPlot("other", [], {}, {});</script>',
        '<script>Plotly.newPlot("chart", [], {}, {}); Plotly.addFrames("chart", []);</script>',
        '<script>Plotly.newPlot("chart", [], {}, {});</script>' + " " * 8_388_608,
    ]:
        item = _html_plot_item(html)
        assert item["kind"] == "placeholder"
        assert item["mime_group"] == "plotly"
        assert "unsupported HTML chart script" in item["summary"]


def test_plain_html_stays_html_and_plotly_mime_takes_precedence() -> None:
    assert _html_plot_item("<table><tr><td>42</td></tr></table>")["kind"] == "html"
    assert _html_plot_item('<pre>Plotly.newPlot("chart", [], {}, {});</pre>')["kind"] == "html"
    spec = {"data": [{"type": "bar", "y": [1]}]}
    output = _plotly_output(spec)
    output["data"]["text/html"] = '<script>Plotly.newPlot("chart", dynamic, {}, {});</script>'
    payload = _build_snapshot(
        base_cells=[_code_cell("preferred")],
        head_cells=[_code_cell("preferred", outputs=[output])],
    )
    assert _items(_rows_by_cell_id(payload)["preferred"])[0]["spec"] == spec


def test_plotly_output_malformed_is_visible_placeholder_not_broken_json() -> None:
    payload = _build_snapshot(
        base_cells=[_code_cell("bad-plot")],
        head_cells=[_code_cell("bad-plot", outputs=[_plotly_output({"data": "not-a-list"})])],
    )
    item = _items(_rows_by_cell_id(payload)["bad-plot"])[0]
    assert item["kind"] == "placeholder"
    assert item["mime_group"] == "plotly"
    assert "malformed" in item["summary"]


def test_plotly_output_oversized_is_visible_placeholder_never_truncated() -> None:
    huge_spec = {"data": [{"type": "scatter", "y": [0.123456] * 400_000}]}
    assert len(json.dumps(huge_spec)) > _INTERACTIVE_SPEC_MAX_BYTES
    payload = _build_snapshot(
        base_cells=[_code_cell("huge-plot")],
        head_cells=[_code_cell("huge-plot", outputs=[_plotly_output(huge_spec)])],
    )
    item = _items(_rows_by_cell_id(payload)["huge-plot"])[0]
    assert item["kind"] == "placeholder"
    assert item["mime_group"] == "plotly"
    assert f"exceeds {_INTERACTIVE_SPEC_MAX_BYTES} bytes" in item["summary"]


def test_widget_output_module_rejects_jupyter_widgets_output() -> None:
    # @jupyter-widgets/output can replay arbitrary notebook mimetypes
    # (including sanitized HTML) inside the widget, widening the trusted
    # rendering surface beyond "standard saved widgets"; the backend
    # allowlist must match the frontend's SUPPORTED_WIDGET_MODULES
    # (apps/web/lib/interactive-output.ts), which deliberately excludes it.
    model = _widget_model(module="@jupyter-widgets/output")
    payload = _build_snapshot(
        base_cells=[_code_cell("widget-output-module")],
        head_cells=[_code_cell("widget-output-module", outputs=[_widget_output("model-output")])],
        head_widget_state=_widget_manager_state(dict([("model-output", model)])),
    )
    item = _items(_rows_by_cell_id(payload)["widget-output-module"])[0]
    assert item["kind"] == "placeholder"
    assert item["mime_group"] == "widget"
    assert "custom widget module" in item["summary"]
    assert "@jupyter-widgets/output" in item["summary"]


def test_widget_output_rejects_inner_model_module_smuggled_past_allowed_envelope() -> None:
    # The envelope's own model_module can claim a standard, allowed module
    # while the model's saved state carries its own _model_module/
    # _view_module attributes -- the fields ipywidgets' real base-manager
    # actually reads to decide which JS module to instantiate. A payload
    # smuggling a hostile reference only in those inner fields must still be
    # rejected, not just the envelope-level check.
    inner_state = dict([("_model_module", "@jupyter-widgets/controls"), ("_view_module", "https://evil.example/widget.js")])
    model = _widget_model(module="@jupyter-widgets/controls", state=inner_state)
    payload = _build_snapshot(
        base_cells=[_code_cell("widget-smuggle")],
        head_cells=[_code_cell("widget-smuggle", outputs=[_widget_output("model-smuggle")])],
        head_widget_state=_widget_manager_state(dict([("model-smuggle", model)])),
    )
    item = _items(_rows_by_cell_id(payload)["widget-smuggle"])[0]
    assert item["kind"] == "placeholder"
    assert item["mime_group"] == "widget"
    assert "custom widget module" in item["summary"]
    assert "evil.example" in item["summary"]


# ---------------------------------------------------------------------------
# widget
# ---------------------------------------------------------------------------


def _widget_output(model_id: str) -> dict[str, Any]:
    return {
        "output_type": "display_data",
        "data": {"application/vnd.jupyter.widget-view+json": _widget_view(model_id)},
    }


def test_widget_output_renders_matching_saved_state() -> None:
    payload = _build_snapshot(
        base_cells=[_code_cell("widget-cell")],
        head_cells=[_code_cell("widget-cell", outputs=[_widget_output("model-1")])],
        head_widget_state=_widget_manager_state({"model-1": _widget_model(state={"value": 7})}),
    )
    item = _items(_rows_by_cell_id(payload)["widget-cell"])[0]
    assert item["kind"] == "widget"
    assert item["view"]["model_id"] == "model-1"
    assert item["state"]["state"]["model-1"]["state"]["value"] == 7


def test_widget_output_missing_state_is_explicit_placeholder() -> None:
    payload = _build_snapshot(
        base_cells=[_code_cell("widget-missing")],
        head_cells=[_code_cell("widget-missing", outputs=[_widget_output("model-absent")])],
    )
    item = _items(_rows_by_cell_id(payload)["widget-missing"])[0]
    assert item["kind"] == "placeholder"
    assert item["mime_group"] == "widget"
    assert "missing saved widget state" in item["summary"]


def test_widget_output_custom_module_is_explicit_placeholder() -> None:
    payload = _build_snapshot(
        base_cells=[_code_cell("widget-custom")],
        head_cells=[_code_cell("widget-custom", outputs=[_widget_output("model-custom")])],
        head_widget_state=_widget_manager_state(
            {"model-custom": _widget_model(module="acme_custom_widgets")}
        ),
    )
    item = _items(_rows_by_cell_id(payload)["widget-custom"])[0]
    assert item["kind"] == "placeholder"
    assert item["mime_group"] == "widget"
    assert "custom widget module" in item["summary"]
    assert "acme_custom_widgets" in item["summary"]


def test_widget_output_oversized_state_is_visible_placeholder_never_truncated() -> None:
    payload = _build_snapshot(
        base_cells=[_code_cell("widget-huge")],
        head_cells=[_code_cell("widget-huge", outputs=[_widget_output("model-huge")])],
        head_widget_state=_widget_manager_state(
            {"model-huge": _widget_model(state={"blob": "x" * (_INTERACTIVE_SPEC_MAX_BYTES + 10)})}
        ),
    )
    item = _items(_rows_by_cell_id(payload)["widget-huge"])[0]
    assert item["kind"] == "placeholder"
    assert item["mime_group"] == "widget"
    assert f"exceeds {_INTERACTIVE_SPEC_MAX_BYTES} bytes" in item["summary"]


def test_widget_state_resolved_from_each_sides_own_notebook_metadata() -> None:
    # Base and head reference *different* model ids (so both sides are
    # rendered as a before/after pair) and each side's saved widget state
    # only defines its own model. If state resolution ever mixed sides up,
    # one side would incorrectly report missing state.
    payload = _build_snapshot(
        base_cells=[_code_cell("widget-sides", outputs=[_widget_output("model-base")])],
        head_cells=[_code_cell("widget-sides", outputs=[_widget_output("model-head")])],
        base_widget_state=_widget_manager_state({"model-base": _widget_model(state={"value": 1})}),
        head_widget_state=_widget_manager_state({"model-head": _widget_model(state={"value": 2})}),
    )
    items = _items(_rows_by_cell_id(payload)["widget-sides"])
    by_side = {item["side"]: item for item in items}
    assert by_side["head"]["kind"] == "widget"
    assert by_side["head"]["state"]["state"]["model-head"]["state"]["value"] == 2
    assert by_side["base"]["kind"] == "widget"
    assert by_side["base"]["state"]["state"]["model-base"]["state"]["value"] == 1


# ---------------------------------------------------------------------------
# widget saved-state-only changes (Phase 2 gap: identical output JSON, only
# the resolved saved widget state differs)
# ---------------------------------------------------------------------------


def test_widget_state_only_change_renders_before_after_pair() -> None:
    # Same model_id on both sides (raw output JSON identical): only the
    # saved state value differs. This must still surface as `output_changed`
    # with a rendered before/after widget pair, not a silently unchanged row.
    payload = _build_snapshot(
        base_cells=[_code_cell("widget-state-only", outputs=[_widget_output("model-1")])],
        head_cells=[_code_cell("widget-state-only", outputs=[_widget_output("model-1")])],
        base_widget_state=_widget_manager_state({"model-1": _widget_model(state={"value": 1})}),
        head_widget_state=_widget_manager_state({"model-1": _widget_model(state={"value": 2})}),
    )
    row = _rows_by_cell_id(payload)["widget-state-only"]
    assert row["change_type"] == "output_changed"
    assert row["outputs"]["changed"] is True
    by_side = {item["side"]: item for item in _items(row)}
    assert by_side["head"]["kind"] == "widget"
    assert by_side["head"]["state"]["state"]["model-1"]["state"]["value"] == 2
    assert by_side["base"]["kind"] == "widget"
    assert by_side["base"]["state"]["state"]["model-1"]["state"]["value"] == 1


def test_widget_state_change_in_transitively_referenced_model_is_detected() -> None:
    # The displayed widget (model-a) is unchanged itself, but it references
    # model-b (e.g. as a child), and model-b's saved state changes. This must
    # be detected transitively, not just at the directly-referenced model.
    base_state = _widget_manager_state(
        {
            "model-a": _widget_model(state={"children": ["IPY_MODEL_model-b"]}),
            "model-b": _widget_model(state={"value": 1}),
        }
    )
    head_state = _widget_manager_state(
        {
            "model-a": _widget_model(state={"children": ["IPY_MODEL_model-b"]}),
            "model-b": _widget_model(state={"value": 2}),
        }
    )
    payload = _build_snapshot(
        base_cells=[_code_cell("widget-transitive", outputs=[_widget_output("model-a")])],
        head_cells=[_code_cell("widget-transitive", outputs=[_widget_output("model-a")])],
        base_widget_state=base_state,
        head_widget_state=head_state,
    )
    row = _rows_by_cell_id(payload)["widget-transitive"]
    assert row["change_type"] == "output_changed"
    by_side = {item["side"]: item for item in _items(row)}
    assert by_side["head"]["state"]["state"]["model-b"]["state"]["value"] == 2
    assert by_side["base"]["state"]["state"]["model-b"]["state"]["value"] == 1


def test_unrelated_widget_model_change_does_not_mark_other_cells_dirty() -> None:
    # model-unrelated is never referenced by any cell's widget-view output;
    # editing its saved state must not dirty the cell that displays model-a.
    base_state = _widget_manager_state(
        {
            "model-a": _widget_model(state={"value": 1}),
            "model-unrelated": _widget_model(state={"value": 1}),
        }
    )
    head_state = _widget_manager_state(
        {
            "model-a": _widget_model(state={"value": 1}),
            "model-unrelated": _widget_model(state={"value": 99}),
        }
    )
    payload = _build_snapshot(
        base_cells=[_code_cell("widget-a", outputs=[_widget_output("model-a")])],
        head_cells=[_code_cell("widget-a", outputs=[_widget_output("model-a")])],
        base_widget_state=base_state,
        head_widget_state=head_state,
    )
    assert "widget-a" not in _rows_by_cell_id(payload)


def test_widget_state_missing_transition_renders_before_after_placeholder() -> None:
    # Same model_id on both sides, but the saved state disappears entirely
    # on head (e.g. widget metadata dropped). This is a real, reviewable
    # change: before shows the resolved widget, after shows an explicit
    # missing-state placeholder.
    payload = _build_snapshot(
        base_cells=[_code_cell("widget-vanishes", outputs=[_widget_output("model-1")])],
        head_cells=[_code_cell("widget-vanishes", outputs=[_widget_output("model-1")])],
        base_widget_state=_widget_manager_state({"model-1": _widget_model(state={"value": 1})}),
        head_widget_state=None,
    )
    row = _rows_by_cell_id(payload)["widget-vanishes"]
    assert row["change_type"] == "output_changed"
    by_side = {item["side"]: item for item in _items(row)}
    assert by_side["base"]["kind"] == "widget"
    assert by_side["head"]["kind"] == "placeholder"
    assert "missing saved widget state" in by_side["head"]["summary"]


def test_widget_state_unchanged_produces_no_row() -> None:
    # Identical model_id and identical saved state on both sides: nothing
    # changed, so no row should be emitted for this cell at all.
    state = _widget_manager_state({"model-1": _widget_model(state={"value": 1})})
    payload = _build_snapshot(
        base_cells=[_code_cell("widget-stable", outputs=[_widget_output("model-1")])],
        head_cells=[_code_cell("widget-stable", outputs=[_widget_output("model-1")])],
        base_widget_state=state,
        head_widget_state=_widget_manager_state({"model-1": _widget_model(state={"value": 1})}),
    )
    assert "widget-stable" not in _rows_by_cell_id(payload)


# ---------------------------------------------------------------------------
# before/after `side` labeling and legacy backward compatibility
# ---------------------------------------------------------------------------


def test_added_only_output_has_no_side_field_for_backward_compatibility() -> None:
    payload = _build_snapshot(
        base_cells=[_code_cell("added-cell")],
        head_cells=[
            _code_cell(
                "added-cell",
                outputs=[{"output_type": "stream", "name": "stdout", "text": "new\n"}],
            )
        ],
    )
    item = _items(_rows_by_cell_id(payload)["added-cell"])[0]
    assert item["change_type"] == "added"
    assert "side" not in item


def test_removed_only_output_has_no_side_field_for_backward_compatibility() -> None:
    payload = _build_snapshot(
        base_cells=[
            _code_cell(
                "removed-cell",
                outputs=[{"output_type": "stream", "name": "stdout", "text": "old\n"}],
            )
        ],
        head_cells=[_code_cell("removed-cell")],
    )
    item = _items(_rows_by_cell_id(payload)["removed-cell"])[0]
    assert item["change_type"] == "removed"
    assert "side" not in item


def test_unchanged_output_content_has_no_side_field_for_backward_compatibility() -> None:
    # Source differs (so the cell still shows up as a changed row) while the
    # output content itself is identical on both sides.
    unchanged_output = [{"output_type": "stream", "name": "stdout", "text": "same\n"}]
    base_cell = _code_cell("same-cell", outputs=unchanged_output)
    base_cell["source"] = "render_old()"
    head_cell = _code_cell("same-cell", outputs=unchanged_output)
    head_cell["source"] = "render_new()"
    payload = _build_snapshot(
        base_cells=[base_cell],
        head_cells=[head_cell],
    )
    items = _items(_rows_by_cell_id(payload)["same-cell"])
    assert len(items) == 1
    assert "side" not in items[0]


def test_modified_output_with_different_content_renders_before_and_after_pair() -> None:
    payload = _build_snapshot(
        base_cells=[
            _code_cell(
                "modified-cell",
                outputs=[{"output_type": "stream", "name": "stdout", "text": "before\n"}],
            )
        ],
        head_cells=[
            _code_cell(
                "modified-cell",
                outputs=[{"output_type": "stream", "name": "stdout", "text": "after\n"}],
            )
        ],
    )
    items = _items(_rows_by_cell_id(payload)["modified-cell"])
    by_side = {item["side"]: item for item in items}
    assert by_side["head"]["text"] == "after\n"
    assert by_side["head"]["change_type"] == "modified"
    assert by_side["base"]["text"] == "before\n"
    assert by_side["base"]["change_type"] == "removed"


# ---------------------------------------------------------------------------
# asset rewrite: `side` preservation and legacy compatibility
# ---------------------------------------------------------------------------


def _snapshot_payload_with_image_items(items: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    return {
        "schema_version": 1,
        "review": {
            "notices": [],
            "notebooks": [
                {
                    "path": "analysis/rich.ipynb",
                    "change_type": "modified",
                    "notices": [],
                    "render_rows": [
                        {
                            "outputs": {"changed": True, "items": list(items)},
                        }
                    ],
                }
            ],
        },
    }


def test_rewrite_asset_refs_preserves_side_for_before_after_image_items() -> None:
    snapshot_payload = _snapshot_payload_with_image_items(
        [
            {
                "kind": "image",
                "asset_key": "sha256:before",
                "mime_type": "image/png",
                "width": 1,
                "height": 1,
                "change_type": "removed",
                "side": "base",
            },
            {
                "kind": "image",
                "asset_key": "sha256:after",
                "mime_type": "image/png",
                "width": 1,
                "height": 1,
                "change_type": "added",
                "side": "head",
            },
        ]
    )

    rewritten = _rewrite_snapshot_payload_asset_refs(
        snapshot_payload=snapshot_payload,
        asset_ids_by_key={"sha256:before": "asset-1", "sha256:after": "asset-2"},
    )

    items = rewritten["review"]["notebooks"][0]["render_rows"][0]["outputs"]["items"]
    before_item, after_item = items
    assert before_item["asset_id"] == "asset-1"
    assert before_item["side"] == "base"
    assert "asset_key" not in before_item
    assert after_item["asset_id"] == "asset-2"
    assert after_item["side"] == "head"


def test_rewrite_asset_refs_keeps_legacy_image_items_without_side() -> None:
    snapshot_payload = _snapshot_payload_with_image_items(
        [
            {
                "kind": "image",
                "asset_key": "sha256:legacy",
                "mime_type": "image/png",
                "width": 1,
                "height": 1,
                "change_type": "modified",
            }
        ]
    )

    rewritten = _rewrite_snapshot_payload_asset_refs(
        snapshot_payload=snapshot_payload,
        asset_ids_by_key={"sha256:legacy": "asset-legacy"},
    )

    item = rewritten["review"]["notebooks"][0]["render_rows"][0]["outputs"]["items"][0]
    assert item == {
        "kind": "image",
        "asset_id": "asset-legacy",
        "mime_type": "image/png",
        "width": 1,
        "height": 1,
        "change_type": "modified",
    }
    assert "side" not in item


def test_rewrite_asset_refs_passes_through_non_image_kinds_including_side() -> None:
    snapshot_payload = _snapshot_payload_with_image_items(
        [
            {
                "kind": "text",
                "text": "hello",
                "mime_type": "text/plain",
                "summary": "text output updated (5 chars)",
                "truncated": False,
                "change_type": "added",
                "side": "head",
            }
        ]
    )

    rewritten = _rewrite_snapshot_payload_asset_refs(
        snapshot_payload=snapshot_payload,
        asset_ids_by_key={},
    )

    item = rewritten["review"]["notebooks"][0]["render_rows"][0]["outputs"]["items"][0]
    assert item["kind"] == "text"
    assert item["side"] == "head"
    assert item["text"] == "hello"
