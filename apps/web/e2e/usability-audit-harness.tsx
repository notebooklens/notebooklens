import React from "react";
import { createRoot } from "react-dom/client";
import { ReviewWorkspace } from "../components/review-workspace";
import { buildNotebook, buildRowForNotebook, buildThread, buildWorkspaceFromNotebooks } from "./workspace-fixture";
import type { RenderRow } from "../lib/types";

function row(path: string, index: number, overrides: Partial<RenderRow>) {
  const value = buildRowForNotebook(path, overrides);
  value.locator = { cell_id: `cell-${index}`, base_index: index, head_index: index, display_index: index };
  for (const anchor of Object.values(value.thread_anchors)) {
    anchor.cell_locator = value.locator;
    anchor.source_fingerprint = `fingerprint-${index}-${anchor.block_kind}`;
  }
  return value;
}
const changed = row("analysis/model_validation.ipynb", 1, {
  source: { base: "samples = [12, 18]\nmean = sum(samples) / 2\nprint(mean)", head: "samples = [12, 18, 24]\ncount = len(samples)\nmean = sum(samples) / count\nprint(mean)", changed: true },
  outputs: { changed: true, items: [
    { kind: "text", side: "base", text: "15.0", mime_type: "text/plain", summary: "Mean", change_type: "modified", truncated: false },
    { kind: "text", side: "head", text: "18.0", mime_type: "text/plain", summary: "Mean", change_type: "modified", truncated: false },
  ] },
  metadata: { changed: true, summary: "Cell tags changed." },
});
const outputOnly = row("analysis/model_validation.ipynb", 2, {
  source: { base: "evaluate(model, validation)", head: "evaluate(model, validation)", changed: false },
  outputs: { changed: true, items: [
    { kind: "html", side: "base", html: "<table><tr><th>Metric</th><th>Value</th></tr><tr><td>Accuracy</td><td>0.92</td></tr><tr><td>Recall</td><td>0.86</td></tr></table>", summary: "Validation metrics", change_type: "modified", truncated: false },
    { kind: "html", side: "head", html: "<table><tr><th>Metric</th><th>Value</th></tr><tr><td>Accuracy</td><td>0.89</td></tr><tr><td>Recall</td><td>0.91</td></tr></table>", summary: "Validation metrics", change_type: "modified", truncated: false },
  ] },
});
const metadataOnly = row("analysis/data_quality.ipynb", 3, { metadata: { changed: true, summary: "Cell tags changed." }, outputs: { changed: false, items: [] } });
const added = row("analysis/data_quality.ipynb", 4, { change_type: "added", source: { base: null, head: "assert observations.notna().all()\nprint('No missing observations')", changed: true }, outputs: { changed: false, items: [] } });
const moved = row("reports/summary.ipynb", 5, { change_type: "moved", source: { base: "report(metrics)", head: "report(metrics)", changed: false }, outputs: { changed: false, items: [] } });
const first = buildNotebook("analysis/model_validation.ipynb", changed); first.render_rows.push(outputOnly);
const second = buildNotebook("analysis/data_quality.ipynb", metadataOnly); second.render_rows.push(added);
const workspace = buildWorkspaceFromNotebooks([first, second, buildNotebook("reports/summary.ipynb", moved)]);
workspace.threads = [buildThread(changed, { id: "discussion-source", anchor: changed.thread_anchors.source }), buildThread(outputOnly, { id: "discussion-output" })];
workspace.review.thread_counts.unresolved = 2;
const mode = new URLSearchParams(window.location.search).get("state");
if (mode === "empty") { workspace.snapshot!.payload.review.notebooks = []; workspace.snapshot!.notebook_count = 0; workspace.snapshot!.changed_cell_count = 0; workspace.threads = []; workspace.review.thread_counts.unresolved = 0; }
if (mode === "loading") workspace.snapshot!.status = "pending";
if (mode === "error") { workspace.snapshot!.status = "failed"; workspace.snapshot!.failure_reason = "Synthetic snapshot build failed."; }
if (mode === "historical") workspace.review.latest_snapshot_id = "snapshot-3";
createRoot(document.getElementById("root")!).render(<ReviewWorkspace workspace={workspace} currentPath="/reviews/example/notebooks/pulls/7" flashNotice={mode === "success" ? { tone: "success", message: "Synthetic discussion saved." } : null} />);
