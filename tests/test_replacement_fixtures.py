"""Phase 2 acceptance fixtures: a bounded three-notebook trio
(`replacement_base.ipynb` -> `replacement_head.ipynb` -> `replacement_followup.ipynb`)
exercising `build_review_artifacts` end to end across every rich-output kind
(Markdown table, code edit, pandas-style HTML, text/error, embedded PNG,
Plotly, ipywidgets IntSlider) plus a state-only follow-up review (same
widget model_id, changed saved state) and a moved+edited cell."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Mapping

from src.claude_integration import NoneProvider
from src.diff_engine import NotebookInput
from src.review_core import ReviewCoreRequest, build_review_artifacts


FIXTURES_DIR = Path(__file__).parent / "fixtures"


def fixture_text(name: str) -> str:
    return (FIXTURES_DIR / name).read_text(encoding="utf-8")


def _snapshot(base_content: str, head_content: str) -> dict[str, Any]:
    artifacts = build_review_artifacts(
        ReviewCoreRequest(
            notebook_inputs=[
                NotebookInput(
                    path="analysis/park_visits.ipynb",
                    change_type="modified",
                    base_content=base_content,
                    head_content=head_content,
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


def _items_by_side(row: Mapping[str, Any]) -> dict[str, Any]:
    return {item["side"]: item for item in _items(row)}


# ---------------------------------------------------------------------------
# fixture sanity
# ---------------------------------------------------------------------------


def test_fixtures_are_valid_nbformat_with_stable_unique_cell_ids() -> None:
    for name in (
        "replacement_base.ipynb",
        "replacement_head.ipynb",
        "replacement_followup.ipynb",
    ):
        notebook = json.loads(fixture_text(name))
        assert notebook["nbformat"] == 4
        assert notebook["nbformat_minor"] == 5
        cell_ids = [cell["id"] for cell in notebook["cells"]]
        assert len(cell_ids) == len(set(cell_ids)), f"duplicate cell ids in {name}"
        for cell_id in cell_ids:
            assert 1 <= len(cell_id) <= 64
            assert all(char.isalnum() or char in "-_" for char in cell_id)


# ---------------------------------------------------------------------------
# base -> head: cross-type before/after coverage
# ---------------------------------------------------------------------------


def test_base_head_markdown_table_edit_renders_source_before_after() -> None:
    payload = _snapshot(
        fixture_text("replacement_base.ipynb"), fixture_text("replacement_head.ipynb")
    )
    row = _rows_by_cell_id(payload)["md-intro"]
    assert row["cell_type"] == "markdown"
    assert row["change_type"] == "modified"
    assert row["source"]["changed"] is True
    assert "| Riverside | 120 |" in row["source"]["base"]
    assert "| Riverside | 140 |" in row["source"]["head"]
    assert "| Hilltop | 60 |" in row["source"]["head"]
    assert "| Hilltop | 60 |" not in row["source"]["base"]


def test_base_head_pandas_html_output_renders_before_after_pair() -> None:
    payload = _snapshot(
        fixture_text("replacement_base.ipynb"), fixture_text("replacement_head.ipynb")
    )
    row = _rows_by_cell_id(payload)["summary-table"]
    assert row["change_type"] == "modified"
    assert row["source"]["changed"] is True
    by_side = _items_by_side(row)
    assert by_side["base"]["kind"] == "html"
    assert "<td>95</td>" in by_side["base"]["html"]
    assert by_side["head"]["kind"] == "html"
    assert "<td>110</td>" in by_side["head"]["html"]
    assert "<td>60</td>" in by_side["head"]["html"]


def test_base_head_validate_columns_text_becomes_error_cross_type() -> None:
    # Base emits a plain stdout stream; head raises instead (a schema
    # assumption regressed). Both render via the same `text` kind but with
    # different `mime_type`s -- a cross-type before/after pair.
    payload = _snapshot(
        fixture_text("replacement_base.ipynb"), fixture_text("replacement_head.ipynb")
    )
    row = _rows_by_cell_id(payload)["validate-columns"]
    assert row["change_type"] == "modified"
    by_side = _items_by_side(row)
    assert by_side["base"]["kind"] == "text"
    assert by_side["base"]["mime_type"] == "stream"
    assert by_side["base"]["text"] == "columns valid: park, visits\n"
    assert by_side["head"]["kind"] == "text"
    assert by_side["head"]["mime_type"] == "error"
    assert "KeyError: 'date'" in by_side["head"]["text"]


def test_base_head_embedded_png_renders_distinct_image_assets_before_after() -> None:
    payload = _snapshot(
        fixture_text("replacement_base.ipynb"), fixture_text("replacement_head.ipynb")
    )
    row = _rows_by_cell_id(payload)["trend-plot"]
    assert row["change_type"] == "modified"
    by_side = _items_by_side(row)
    assert by_side["base"]["kind"] == "image"
    assert by_side["head"]["kind"] == "image"
    assert by_side["base"]["mime_type"] == "image/png"
    assert by_side["head"]["mime_type"] == "image/png"
    # Distinct pixel content -> distinct content-addressed asset keys.
    assert by_side["base"]["asset_key"] != by_side["head"]["asset_key"]
    assert payload["review"]["notebooks"][0]["render_rows"]  # sanity: rows exist


def test_base_head_plotly_bar_chart_spec_changes_before_after() -> None:
    payload = _snapshot(
        fixture_text("replacement_base.ipynb"), fixture_text("replacement_head.ipynb")
    )
    row = _rows_by_cell_id(payload)["visits-bar-chart"]
    assert row["change_type"] == "output_changed"
    by_side = _items_by_side(row)
    assert by_side["base"]["kind"] == "plotly"
    assert by_side["base"]["spec"]["data"][0]["y"] == [120, 95]
    assert by_side["head"]["kind"] == "plotly"
    assert by_side["head"]["spec"]["data"][0]["y"] == [140, 110, 60]


def test_base_head_ipywidgets_intslider_added_with_valid_model_and_view() -> None:
    payload = _snapshot(
        fixture_text("replacement_base.ipynb"), fixture_text("replacement_head.ipynb")
    )
    row = _rows_by_cell_id(payload)["visits-slider"]
    assert row["change_type"] == "added"
    item = _items(row)[0]
    assert item["kind"] == "widget"
    assert item["view"]["model_id"] == "slider-park-visits"
    model_state = item["state"]["state"]["slider-park-visits"]
    assert model_state["model_name"] == "IntSliderModel"
    assert model_state["model_module"] == "@jupyter-widgets/controls"
    assert model_state["state"]["value"] == 10
    # `side` is not set for pure additions (backward compatibility).
    assert "side" not in item


def test_base_head_load_data_cell_is_unchanged_and_has_no_row() -> None:
    payload = _snapshot(
        fixture_text("replacement_base.ipynb"), fixture_text("replacement_head.ipynb")
    )
    assert "load-data" not in _rows_by_cell_id(payload)


# ---------------------------------------------------------------------------
# head -> followup: state-only widget change + moved+edited cell
# ---------------------------------------------------------------------------


def test_head_followup_widget_state_only_change_same_model_id() -> None:
    # The `visits-slider` cell's output JSON (and view model_id) is byte
    # identical between head and followup; only the saved widget state
    # value changed (10 -> 42). This must still surface as a reviewable
    # before/after pair, not a silently unchanged row.
    payload = _snapshot(
        fixture_text("replacement_head.ipynb"), fixture_text("replacement_followup.ipynb")
    )
    row = _rows_by_cell_id(payload)["visits-slider"]
    assert row["change_type"] == "output_changed"
    assert row["source"]["changed"] is False
    assert row["outputs"]["changed"] is True
    by_side = _items_by_side(row)
    assert by_side["base"]["kind"] == "widget"
    assert by_side["base"]["view"]["model_id"] == "slider-park-visits"
    assert by_side["base"]["state"]["state"]["slider-park-visits"]["state"]["value"] == 10
    assert by_side["head"]["kind"] == "widget"
    assert by_side["head"]["view"]["model_id"] == "slider-park-visits"
    assert by_side["head"]["state"]["state"]["slider-park-visits"]["state"]["value"] == 42


def test_head_followup_moved_and_edited_cell_reports_position_and_source_change() -> None:
    # `load-data` moves from index 1 to index 2 (swaps with `summary-table`)
    # *and* gains a filtering line in the same follow-up revision. Editing
    # dominates pure reordering, so this is classified `modified`, but the
    # locator still records the position change.
    payload = _snapshot(
        fixture_text("replacement_head.ipynb"), fixture_text("replacement_followup.ipynb")
    )
    row = _rows_by_cell_id(payload)["load-data"]
    assert row["change_type"] == "modified"
    assert row["locator"]["base_index"] == 1
    assert row["locator"]["head_index"] == 2
    assert row["source"]["changed"] is True
    assert 'visits[visits["visits"] > 0]' not in row["source"]["base"]
    assert 'visits[visits["visits"] > 0]' in row["source"]["head"]


def test_head_followup_reorder_without_content_change_yields_no_row() -> None:
    # `summary-table` also shifts position (index 2 -> 1) because
    # `load-data` moved past it, but its own source/outputs/metadata are
    # untouched, so it must not appear as a dirty row.
    payload = _snapshot(
        fixture_text("replacement_head.ipynb"), fixture_text("replacement_followup.ipynb")
    )
    assert "summary-table" not in _rows_by_cell_id(payload)


def test_head_followup_unrelated_cells_are_unchanged() -> None:
    payload = _snapshot(
        fixture_text("replacement_head.ipynb"), fixture_text("replacement_followup.ipynb")
    )
    rows = _rows_by_cell_id(payload)
    for cell_id in ("md-intro", "validate-columns", "trend-plot", "visits-bar-chart"):
        assert cell_id not in rows
