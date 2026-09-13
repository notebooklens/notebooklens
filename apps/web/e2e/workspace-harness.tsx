import React from "react";
import { createRoot } from "react-dom/client";
import { ReviewWorkspace } from "../components/review-workspace";
import { buildRow, buildThread, buildWorkspace } from "./workspace-fixture";

const row = buildRow({
  source: { base: "visits = [12, 18]\nmean = sum(visits) / 2\nprint(mean)", head: "visits = [12, 18, 24]\ncount = len(visits)\nmean = sum(visits) / count\nprint(mean)", changed: true },
  outputs: { changed: true, items: [
    { kind: "placeholder", side: "base", output_type: "stream", mime_group: "text", summary: "15.0", change_type: "modified", truncated: false },
    { kind: "placeholder", side: "head", output_type: "stream", mime_group: "text", summary: "18.0", change_type: "modified", truncated: false },
    { kind: "html", side: "head", summary: "Saved note", html: '<label>Saved note <input aria-label="Saved note" value="initial"></label>', change_type: "modified", truncated: false },
  ] },
  metadata: { changed: true, summary: "Cell tags changed." },
});
if (window.location.search.includes("added")) {
  row.change_type = "added"; row.source.base = null;
  row.outputs.items = row.outputs.items.filter((item) => item.side === "head").map((item) => ({ ...item, change_type: "added" }));
}
if (window.location.search.includes("empty")) { row.source.base = ""; row.source.head = "first\nsecond"; }
if (window.location.search.includes("deleted")) {
  row.change_type = "deleted";
  row.source = { base: "retired_metric = 15", head: null, changed: true };
  row.outputs = { changed: true, items: [{ kind: "placeholder", side: "base", output_type: "stream", mime_group: "text", summary: "Retired saved output", change_type: "removed", truncated: false }] };
}
if (window.location.search.includes("moved")) {
  row.change_type = "moved";
  row.locator.base_index = 0;
  row.locator.head_index = 1;
  row.source = { base: "value = 1", head: "value = 1", changed: false };
  row.outputs = { changed: false, items: [] };
}
const workspace = buildWorkspace(row);
if (window.location.search.includes("history")) {
  workspace.review.snapshot_history.unshift({ ...workspace.review.snapshot_history[0], id: "snapshot-1", snapshot_index: 1, is_latest: false });
  workspace.review.selected_snapshot_index = 1;
  workspace.snapshot!.snapshot_index = 1;
}
if (window.location.search.includes("seven-versions")) {
  workspace.review.snapshot_history = Array.from({ length: 7 }, (_, index) => ({ ...workspace.review.snapshot_history[0], id: `snapshot-${index + 1}`, snapshot_index: index + 1, is_latest: index === 6, head_commit_subject: index === 0 ? null : `Refine notebook analysis ${index + 1}: compare weekly observations and preserve the full descriptive commit subject for reviewers` }));
  workspace.review.selected_snapshot_index = 7;
  workspace.review.latest_snapshot_index = 7;
  workspace.snapshot!.snapshot_index = 7;
}
if (window.location.search.includes("added")) workspace.snapshot!.payload.review.notebooks[0].change_type = "added";
if (window.location.search.includes("deleted")) workspace.snapshot!.payload.review.notebooks[0].change_type = "deleted";
if (window.location.search.includes("markdown")) {
  row.cell_type = "markdown";
  row.source = { base: row.change_type === "added" ? null : "# Previous report\nRemoved explanation.", head: row.change_type === "deleted" ? null : "# New report\nAdded explanation.", changed: true };
  for (const anchor of Object.values(row.thread_anchors)) anchor.cell_type = "markdown";
}
workspace.threads = [buildThread(row)];
if (window.location.search.includes("mixed-cells")) {
  const markdown = buildRow({
    cell_type: "markdown", change_type: "added",
    summary: "Introduction added.",
    locator: { cell_id: "intro", base_index: null, head_index: 0, display_index: 0 },
    source: { base: null, head: "# Weekly observations\nReview the updated sample before interpreting the result.", changed: true },
    outputs: { changed: false, items: [] },
  });
  for (const anchor of Object.values(markdown.thread_anchors)) {
    anchor.cell_type = "markdown";
    anchor.cell_locator = markdown.locator;
    anchor.source_fingerprint = `intro-${anchor.block_kind}`;
  }
  workspace.snapshot!.payload.review.notebooks[0].render_rows.unshift(markdown);
  workspace.threads = [];
  workspace.review.thread_counts.unresolved = 0;
}
if (window.location.search.includes("original-context")) {
  workspace.threads[0].anchor_drifted = true;
  workspace.threads[0].origin_snapshot_id = "original-snapshot";
  workspace.review.snapshot_history.unshift({ ...workspace.review.snapshot_history[0], id: "original-snapshot", snapshot_index: 1, is_latest: false });
}
if (window.location.search.includes("metadata-only")) {
  row.source.changed = false;
  row.source.head = row.source.base;
  row.outputs = { changed: false, items: [] };
  workspace.threads[0].anchor = row.thread_anchors.metadata;
}
createRoot(document.getElementById("root")!).render(<ReviewWorkspace workspace={workspace} currentPath="/reviews/example/notebooks/pulls/7" flashNotice={null} />);
