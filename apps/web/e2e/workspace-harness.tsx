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
const workspace = buildWorkspace(row);
workspace.threads = [buildThread(row)];
createRoot(document.getElementById("root")!).render(<ReviewWorkspace workspace={workspace} currentPath="/reviews/example/notebooks/pulls/7" flashNotice={null} />);
