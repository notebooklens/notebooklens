from __future__ import annotations

import json
from pathlib import Path

from src.diff_engine import DiffLimits, NotebookInput, build_notebook_diff


FIXTURES_DIR = Path(__file__).parent / "fixtures"


def fixture_text(name: str) -> str:
    return (FIXTURES_DIR / name).read_text(encoding="utf-8")


def fixture_json(name: str) -> dict[str, object]:
    return json.loads(fixture_text(name))


def _input(
    *,
    path: str,
    change_type: str,
    base_fixture: str | None = None,
    head_fixture: str | None = None,
    base_size_bytes: int | None = None,
    head_size_bytes: int | None = None,
) -> NotebookInput:
    return NotebookInput(
        path=path,
        change_type=change_type,  # type: ignore[arg-type]
        base_content=fixture_text(base_fixture) if base_fixture else None,
        head_content=fixture_text(head_fixture) if head_fixture else None,
        base_size_bytes=base_size_bytes,
        head_size_bytes=head_size_bytes,
    )


def _notebook_json(cell_count: int, line_prefix: str) -> str:
    cells = []
    for idx in range(cell_count):
        cells.append(
            {
                "cell_type": "code",
                "id": f"c{idx}",
                "metadata": {},
                "execution_count": idx + 1,
                "source": [f"{line_prefix}_{idx}\n"],
                "outputs": [],
            }
        )
    payload = {
        "cells": cells,
        "metadata": {
            "kernelspec": {"name": "python3", "display_name": "Python 3"},
            "language_info": {"name": "python", "version": "3.11"},
        },
        "nbformat": 4,
        "nbformat_minor": 5,
    }
    return json.dumps(payload)


def test_simple_fixture_detects_modified_and_added_changes() -> None:
    diff = build_notebook_diff(
        [
            _input(
                path="simple.ipynb",
                change_type="modified",
                base_fixture="simple_base.ipynb",
                head_fixture="simple_head.ipynb",
            )
        ]
    )

    notebook = diff.notebooks[0]
    change_types = {item.change_type for item in notebook.cell_changes}
    assert "modified" in change_types
    assert "added" in change_types
    assert diff.total_notebooks_changed == 1
    assert diff.total_cells_changed == len(notebook.cell_changes)
    assert any(item.review_context for item in notebook.cell_changes)


def test_medium_fixture_covers_output_only_metadata_and_notebook_metadata_changes() -> None:
    diff = build_notebook_diff(
        [
            _input(
                path="medium.ipynb",
                change_type="modified",
                base_fixture="medium_base.ipynb",
                head_fixture="medium_head.ipynb",
            )
        ]
    )

    notebook = diff.notebooks[0]
    assert any("notebook material metadata changed" in item for item in notebook.notices)
    assert any(item.change_type == "output_changed" for item in notebook.cell_changes)
    assert any(item.material_metadata_changed for item in notebook.cell_changes)


def test_complex_fixture_covers_moved_added_deleted_and_binary_output_placeholder() -> None:
    diff = build_notebook_diff(
        [
            _input(
                path="complex.ipynb",
                change_type="modified",
                base_fixture="complex_base.ipynb",
                head_fixture="complex_head.ipynb",
            )
        ]
    )

    notebook = diff.notebooks[0]
    change_types = {item.change_type for item in notebook.cell_changes}
    assert "moved" in change_types
    assert "added" in change_types
    assert "deleted" in change_types
    assert "modified" in change_types or "output_changed" in change_types

    image_outputs = [
        output
        for change in notebook.cell_changes
        for output in change.output_changes
        if output.mime_group == "image"
    ]
    assert image_outputs
    assert all("image output updated" in output.summary for output in image_outputs)
    assert all("iVBOR" not in output.summary for output in image_outputs)


def test_metadata_only_fixture_ignores_non_material_churn() -> None:
    diff = build_notebook_diff(
        [
            _input(
                path="metadata_only.ipynb",
                change_type="modified",
                base_fixture="metadata_only_base.ipynb",
                head_fixture="metadata_only_head.ipynb",
            )
        ]
    )

    notebook = diff.notebooks[0]
    assert notebook.cell_changes == []
    assert notebook.notices == []


def test_review_workspace_thread_fixtures_capture_churn_model_progression() -> None:
    base = fixture_json("review_workspace_thread_base.ipynb")
    head_v1 = fixture_json("review_workspace_thread_head_v1.ipynb")
    head_v2 = fixture_json("review_workspace_thread_head_v2.ipynb")

    base_cells = base["cells"]  # type: ignore[index]
    head_v1_cells = head_v1["cells"]  # type: ignore[index]
    head_v2_cells = head_v2["cells"]  # type: ignore[index]

    assert [cell["id"] for cell in base_cells] == [  # type: ignore[index]
        "intro-cell",
        "load-data-cell",
        "seed-cell",
        "metric-cell",
    ]
    assert base_cells[0]["source"] == head_v1_cells[0]["source"]  # type: ignore[index]
    assert "train.csv" in "".join(base_cells[1]["source"])  # type: ignore[index]
    assert "train_v2.csv" in "".join(head_v1_cells[1]["source"])  # type: ignore[index]
    assert "seed = 42" in "".join(base_cells[2]["source"])  # type: ignore[index]
    assert "seed = 7" in "".join(head_v1_cells[2]["source"])  # type: ignore[index]
    assert base_cells[3]["outputs"][0]["text"] == "accuracy = 0.81\n"  # type: ignore[index]
    assert head_v1_cells[3]["outputs"][0]["text"] == "accuracy = 0.73\n"  # type: ignore[index]
    assert "train_v2.csv" in "".join(head_v2_cells[0]["source"])  # type: ignore[index]
    assert head_v2_cells[3]["outputs"][0]["text"] == "accuracy = 0.78\n"  # type: ignore[index]

    v1_diff = build_notebook_diff(
        [
            _input(
                path="notebooks/training/churn_model.ipynb",
                change_type="modified",
                base_fixture="review_workspace_thread_base.ipynb",
                head_fixture="review_workspace_thread_head_v1.ipynb",
            )
        ]
    )
    v2_diff = build_notebook_diff(
        [
            _input(
                path="notebooks/training/churn_model.ipynb",
                change_type="modified",
                base_fixture="review_workspace_thread_head_v1.ipynb",
                head_fixture="review_workspace_thread_head_v2.ipynb",
            )
        ]
    )

    v1_changes = {
        change.locator.cell_id: change
        for change in v1_diff.notebooks[0].cell_changes
    }
    assert v1_diff.notebooks[0].path == "notebooks/training/churn_model.ipynb"
    assert v1_changes["load-data-cell"].change_type == "modified"
    assert v1_changes["seed-cell"].change_type == "modified"
    assert v1_changes["metric-cell"].change_type == "output_changed"

    v2_changes = {
        change.locator.cell_id: change
        for change in v2_diff.notebooks[0].cell_changes
    }
    assert v2_changes["intro-cell"].change_type == "modified"
    assert v2_changes["metric-cell"].change_type == "output_changed"
    assert v2_changes["metric-cell"].base_source == v2_changes["metric-cell"].head_source


def test_malformed_fixture_is_skipped_with_parse_notice() -> None:
    diff = build_notebook_diff(
        [
            _input(
                path="broken.ipynb",
                change_type="modified",
                base_fixture="simple_base.ipynb",
                head_fixture="malformed.ipynb",
            )
        ]
    )

    notebook = diff.notebooks[0]
    assert notebook.cell_changes == []
    assert any("failed to parse head notebook JSON" in item for item in notebook.notices)
    assert any("failed to parse head notebook JSON" in item for item in diff.notices)


def test_file_size_limit_skips_large_notebook_and_continues() -> None:
    limits = DiffLimits(max_notebook_bytes=120)
    diff = build_notebook_diff(
        [
            _input(
                path="too_large.ipynb",
                change_type="modified",
                base_fixture="simple_base.ipynb",
                head_fixture="simple_head.ipynb",
                head_size_bytes=121,
            )
        ],
        limits=limits,
    )

    notebook = diff.notebooks[0]
    assert notebook.cell_changes == []
    assert any("skipped notebook larger than 120 bytes" in item for item in diff.notices)


def test_notebook_count_limit_processes_deterministic_subset() -> None:
    inputs = [
        _input(
            path=f"nb_{idx}.ipynb",
            change_type="added",
            head_fixture="simple_head.ipynb",
        )
        for idx in range(22)
    ]
    diff = build_notebook_diff(inputs)

    assert diff.total_notebooks_changed == 20
    assert diff.notebooks[0].path == "nb_0.ipynb"
    assert diff.notebooks[-1].path == "nb_19.ipynb"
    assert any("Processed first 20 notebooks" in item for item in diff.notices)


def test_cell_limit_truncates_after_first_500_aligned_cells() -> None:
    diff = build_notebook_diff(
        [
            NotebookInput(
                path="many_cells.ipynb",
                change_type="modified",
                base_content=_notebook_json(505, "base"),
                head_content=_notebook_json(505, "head"),
            )
        ]
    )

    notebook = diff.notebooks[0]
    assert len(notebook.cell_changes) == 500
    assert any(
        "truncated processing after first 500 aligned cells; skipped 5 cells" in item
        for item in notebook.notices
    )


def test_output_truncation_flag_is_set_for_large_text_outputs() -> None:
    base_payload = {
        "cells": [
            {
                "cell_type": "code",
                "id": "cell-1",
                "metadata": {},
                "execution_count": 1,
                "source": ["print('x')\n"],
                "outputs": [],
            }
        ],
        "metadata": {"kernelspec": {"name": "python3"}, "language_info": {"name": "python"}},
        "nbformat": 4,
        "nbformat_minor": 5,
    }
    head_payload = {
        "cells": [
            {
                "cell_type": "code",
                "id": "cell-1",
                "metadata": {},
                "execution_count": 2,
                "source": ["print('x')\n"],
                "outputs": [
                    {
                        "output_type": "stream",
                        "name": "stdout",
                        "text": "z" * 2200,
                    }
                ],
            }
        ],
        "metadata": {"kernelspec": {"name": "python3"}, "language_info": {"name": "python"}},
        "nbformat": 4,
        "nbformat_minor": 5,
    }

    diff = build_notebook_diff(
        [
            NotebookInput(
                path="large_output.ipynb",
                change_type="modified",
                base_content=json.dumps(base_payload),
                head_content=json.dumps(head_payload),
            )
        ]
    )

    output_changes = diff.notebooks[0].cell_changes[0].output_changes
    assert output_changes
    assert output_changes[0].truncated is True
    assert "2200 chars" in output_changes[0].summary



# ---------------------------------------------------------------------------
# widget saved-state-only changes (notebook-metadata widget state, separate
# from the per-cell `application/vnd.jupyter.widget-view+json` output)
# ---------------------------------------------------------------------------


_WIDGET_STATE_MIME_TYPE = "application/vnd.jupyter.widget-state+json"
_WIDGET_VIEW_MIME_TYPE = "application/vnd.jupyter.widget-view+json"


def _widget_notebook(cells: list[dict[str, object]], *, widget_state: dict[str, object] | None) -> str:
    metadata: dict[str, object] = {"kernelspec": {"name": "python3"}, "language_info": {"name": "python"}}
    if widget_state is not None:
        metadata["widgets"] = {_WIDGET_STATE_MIME_TYPE: widget_state}
    return json.dumps(
        {
            "cells": cells,
            "metadata": metadata,
            "nbformat": 4,
            "nbformat_minor": 5,
        }
    )


def _widget_manager_state(models: dict[str, object]) -> dict[str, object]:
    return {"version_major": 2, "version_minor": 0, "state": models}


def _widget_model(*, module: str = "@jupyter-widgets/controls", state: dict[str, object]) -> dict[str, object]:
    return {
        "model_name": "IntSliderModel",
        "model_module": module,
        "model_module_version": "2.0.0",
        "state": state,
    }


def _widget_cell(cell_id: str, model_id: str) -> dict[str, object]:
    return {
        "cell_type": "code",
        "id": cell_id,
        "metadata": {},
        "execution_count": 1,
        "source": ["render()\n"],
        "outputs": [
            {
                "output_type": "display_data",
                "data": {
                    _WIDGET_VIEW_MIME_TYPE: {
                        "version_major": 2,
                        "version_minor": 0,
                        "model_id": model_id,
                    }
                },
            }
        ],
    }


def _widget_diff(
    *,
    base_cells: list[dict[str, object]],
    head_cells: list[dict[str, object]],
    base_widget_state: dict[str, object] | None,
    head_widget_state: dict[str, object] | None,
):
    diff = build_notebook_diff(
        [
            NotebookInput(
                path="widgets.ipynb",
                change_type="modified",
                base_content=_widget_notebook(base_cells, widget_state=base_widget_state),
                head_content=_widget_notebook(head_cells, widget_state=head_widget_state),
            )
        ]
    )
    return diff.notebooks[0]


def _cell_change_by_id(notebook, cell_id: str):
    for change in notebook.cell_changes:
        if change.locator.cell_id == cell_id:
            return change
    return None


def test_widget_state_only_change_is_classified_as_output_changed() -> None:
    # Same model_id referenced on both sides (cell source/outputs JSON is
    # byte-for-byte identical): only the saved widget state value differs.
    notebook = _widget_diff(
        base_cells=[_widget_cell("widget-cell", "model-1")],
        head_cells=[_widget_cell("widget-cell", "model-1")],
        base_widget_state=_widget_manager_state({"model-1": _widget_model(state={"value": 1})}),
        head_widget_state=_widget_manager_state({"model-1": _widget_model(state={"value": 2})}),
    )
    change = _cell_change_by_id(notebook, "widget-cell")
    assert change is not None
    assert change.change_type == "output_changed"
    assert change.outputs_changed is True
    assert change.source_changed is False


def test_widget_state_change_in_transitively_referenced_model_is_classified_as_output_changed() -> None:
    # model-a (displayed) is itself unchanged but references model-b, whose
    # saved state changes; the change must still be detected transitively.
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
    notebook = _widget_diff(
        base_cells=[_widget_cell("widget-cell", "model-a")],
        head_cells=[_widget_cell("widget-cell", "model-a")],
        base_widget_state=base_state,
        head_widget_state=head_state,
    )
    change = _cell_change_by_id(notebook, "widget-cell")
    assert change is not None
    assert change.change_type == "output_changed"


def test_unrelated_widget_model_change_does_not_dirty_other_cells() -> None:
    # Two cells: one displays model-a (unchanged), the other has plain
    # unchanged source/outputs. model-unrelated is not referenced by any
    # cell's widget-view output, so editing it must not produce a row for
    # either cell.
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
    plain_cell = {
        "cell_type": "code",
        "id": "plain-cell",
        "metadata": {},
        "execution_count": 1,
        "source": ["x = 1\n"],
        "outputs": [],
    }
    notebook = _widget_diff(
        base_cells=[_widget_cell("widget-cell", "model-a"), plain_cell],
        head_cells=[_widget_cell("widget-cell", "model-a"), plain_cell],
        base_widget_state=base_state,
        head_widget_state=head_state,
    )
    assert _cell_change_by_id(notebook, "widget-cell") is None
    assert _cell_change_by_id(notebook, "plain-cell") is None


def test_widget_state_missing_transition_is_classified_as_output_changed() -> None:
    # Same model_id referenced on both sides, but the saved state disappears
    # entirely on head (e.g. widget metadata dropped).
    notebook = _widget_diff(
        base_cells=[_widget_cell("widget-cell", "model-1")],
        head_cells=[_widget_cell("widget-cell", "model-1")],
        base_widget_state=_widget_manager_state({"model-1": _widget_model(state={"value": 1})}),
        head_widget_state=None,
    )
    change = _cell_change_by_id(notebook, "widget-cell")
    assert change is not None
    assert change.change_type == "output_changed"
    assert change.outputs_changed is True


def test_widget_state_unchanged_produces_no_cell_change() -> None:
    # Identical model_id and identical saved state on both sides.
    state = _widget_manager_state({"model-1": _widget_model(state={"value": 1})})
    notebook = _widget_diff(
        base_cells=[_widget_cell("widget-cell", "model-1")],
        head_cells=[_widget_cell("widget-cell", "model-1")],
        base_widget_state=state,
        head_widget_state=_widget_manager_state({"model-1": _widget_model(state={"value": 1})}),
    )
    assert _cell_change_by_id(notebook, "widget-cell") is None
