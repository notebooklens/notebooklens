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
if (window.location.search.includes("added")) { row.change_type = "added"; row.source.base = null; }
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
workspace.threads = [buildThread(row)];
if (window.location.search.includes("metadata-only")) {
  row.source.changed = false;
  row.source.head = row.source.base;
  row.outputs = { changed: false, items: [] };
  workspace.threads[0].anchor = row.thread_anchors.metadata;
}
createRoot(document.getElementById("root")!).render(<ReviewWorkspace workspace={workspace} currentPath="/reviews/example/notebooks/pulls/7" flashNotice={null} />);
