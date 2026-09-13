import type {
  FlashNotice,
  RenderRow,
  RenderOutputItem,
  ReviewSnapshotRecord,
  ReviewThread,
  SnapshotBlockKind,
  ThreadAnchor,
  WorkspaceReview,
} from "@/lib/types";


export function buildAnchorKey(anchor: ThreadAnchor): string {
  return JSON.stringify({
    notebook_path: anchor.notebook_path,
    block_kind: anchor.block_kind,
    source_fingerprint: anchor.source_fingerprint,
    cell_type: anchor.cell_type,
    cell_locator: {
      cell_id: anchor.cell_locator.cell_id ?? null,
      base_index: anchor.cell_locator.base_index ?? null,
      head_index: anchor.cell_locator.head_index ?? null,
      display_index: anchor.cell_locator.display_index ?? null,
    },
  });
}


export function groupThreadsByAnchor(threads: ReviewThread[]): Map<string, ReviewThread[]> {
  const buckets = new Map<string, ReviewThread[]>();

  for (const thread of threads) {
    const key = buildAnchorKey(thread.anchor);
    const existing = buckets.get(key);
    if (existing) {
      existing.push(thread);
      continue;
    }
    buckets.set(key, [thread]);
  }

  return buckets;
}


export function canStartThread(
  review: WorkspaceReview,
  snapshot: ReviewSnapshotRecord | null,
  row: RenderRow,
  blockKind: ThreadAnchor["block_kind"],
): boolean {
  if (snapshot === null) {
    return false;
  }
  if (snapshot.status !== "ready") {
    return false;
  }
  if (review.latest_snapshot_id !== snapshot.id) {
    return false;
  }
  if (!hasMeaningfulBlockContent(row, blockKind)) {
    return false;
  }
  return isBlockChanged(row, blockKind);
}


export function hasMeaningfulBlockContent(
  row: RenderRow,
  blockKind: SnapshotBlockKind,
): boolean {
  if (blockKind === "source") {
    return hasMeaningfulText(row.source.base) || hasMeaningfulText(row.source.head);
  }
  if (blockKind === "outputs") {
    return row.outputs.items.some(hasMeaningfulOutputItem);
  }
  return hasMeaningfulText(row.metadata.summary);
}


export function getVisibleBlockKinds(
  row: RenderRow,
  threadsByAnchor: Map<string, ReviewThread[]>,
): SnapshotBlockKind[] {
  return (["source", "outputs", "metadata"] as const).filter((blockKind) => {
    const hasThreads = (threadsByAnchor.get(buildAnchorKey(row.thread_anchors[blockKind]))?.length ?? 0) > 0;
    if (hasThreads) {
      return true;
    }
    return isBlockChanged(row, blockKind) && hasMeaningfulBlockContent(row, blockKind);
  });
}


export function hasVisibleBlocks(
  row: RenderRow,
  threadsByAnchor: Map<string, ReviewThread[]>,
): boolean {
  return getVisibleBlockKinds(row, threadsByAnchor).length > 0;
}


export function getMeaningfulOutputItems(
  row: RenderRow,
): RenderRow["outputs"]["items"] {
  return row.outputs.items.filter(hasMeaningfulOutputItem);
}

function hasMeaningfulOutputItem(item: RenderOutputItem): boolean {
  if (item.kind === "image") return true;
  if (hasMeaningfulText(item.summary)) return true;
  switch (item.kind) {
    case "text": return hasMeaningfulText(item.text);
    case "html": return hasMeaningfulText(item.html);
    // This determines visibility only; the sandbox still validates all rich payloads.
    case "plotly": return Array.isArray(item.spec?.data);
    case "widget": return Boolean(item.view && Object.keys(item.view).length && item.state && Object.keys(item.state).length);
    default: return false;
  }
}

export function getChangedBlockKinds(row: RenderRow): SnapshotBlockKind[] {
  return (["source", "outputs", "metadata"] as const).filter((blockKind) =>
    isBlockChanged(row, blockKind),
  );
}


export function getRowSignalSummary(row: RenderRow): string | null {
  const summary = row.summary.trim();
  if (!summary) {
    return null;
  }

  const normalizedSummary = normalizeSummary(summary);
  if (!normalizedSummary) {
    return null;
  }

  const changedBlockLabels = getChangedBlockKinds(row).map((blockKind) =>
    blockKind === "metadata" ? "material metadata" : blockKind,
  );

  const genericSummaries = new Set([
    "cell added",
    "cell deleted",
    "cell modified",
    "cell outputs changed",
    "cell reordered without material content changes",
  ]);

  if (
    genericSummaries.has(normalizedSummary) ||
    normalizedSummary === `cell modified (${changedBlockLabels.join(", ")})`
  ) {
    return null;
  }

  return summary;
}


export function isBlockChanged(
  row: RenderRow,
  blockKind: ThreadAnchor["block_kind"],
): boolean {
  if (blockKind === "source") {
    return row.source.changed;
  }
  if (blockKind === "outputs") {
    return row.outputs.changed;
  }
  return row.metadata.changed;
}


export function buildSnapshotRoute(
  owner: string,
  repo: string,
  pullNumber: number,
  snapshotIndex: number | null,
): string {
  if (snapshotIndex === null) {
    return `/reviews/${owner}/${repo}/pulls/${pullNumber}`;
  }
  return `/reviews/${owner}/${repo}/pulls/${pullNumber}/snapshots/${snapshotIndex}`;
}


export function buildAiGatewayRoute(
  owner: string,
  repo: string,
  pullNumber: number,
): string {
  return `/reviews/${owner}/${repo}/pulls/${pullNumber}/settings/ai-gateway`;
}


export function buildWorkspaceActionPath(
  action: "create-thread" | "reply-thread" | "resolve-thread" | "reopen-thread" | "logout",
): string {
  switch (action) {
    case "create-thread":
      return "/actions/threads/create";
    case "reply-thread":
      return "/actions/threads/reply";
    case "resolve-thread":
      return "/actions/threads/resolve";
    case "reopen-thread":
      return "/actions/threads/reopen";
    case "logout":
      return "/actions/auth/logout";
  }
}


export function toggleThreadComposer(
  currentComposerKey: string | null,
  requestedComposerKey: string,
): string | null {
  return currentComposerKey === requestedComposerKey ? null : requestedComposerKey;
}


export function buildFlashRedirect(
  returnTo: string,
  notice: FlashNotice,
): string {
  const url = new URL(sanitizeWorkspaceReturnTo(returnTo), "https://notebooklens.local");
  url.searchParams.set("flash", notice.tone);
  url.searchParams.set("message", notice.message);
  return `${url.pathname}?${url.searchParams.toString()}${url.hash}`;
}

/** A local redirect target, retaining review query parameters and discussion fragments. */
export function sanitizeWorkspaceReturnTo(returnTo: string): string {
  if (!returnTo.startsWith("/") || returnTo.startsWith("//") || returnTo.includes("\\") || [...returnTo].some((char) => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127)) return "/";
  const url = new URL(returnTo, "https://notebooklens.local");
  // Dot-segment normalization can turn a local path into a protocol-relative path.
  if (url.origin !== "https://notebooklens.local" || url.pathname.startsWith("//")) return "/";
  return `${url.pathname}${url.search}${url.hash}`;
}

export function workspaceRevalidationPath(returnTo: string): string {
  return new URL(sanitizeWorkspaceReturnTo(returnTo), "https://notebooklens.local").pathname;
}

export function readFlashNotice(
  searchParams: Record<string, string | string[] | undefined>,
): FlashNotice | null {
  const tone = firstValue(searchParams.flash);
  const message = firstValue(searchParams.message);
  if ((tone !== "success" && tone !== "error") || !message) {
    return null;
  }
  return {
    tone,
    message,
  };
}


export function formatCellLabel(row: RenderRow): string {
  const displayIndex = row.locator.display_index;
  const ordinal = displayIndex === null ? "Unknown" : `${displayIndex + 1}`;
  return `Cell ${ordinal}`;
}


export function summarizeFinding(
  finding: ReviewSnapshotRecord["flagged_findings"][number],
): string {
  return (
    finding.summary ??
    finding.message ??
    finding.code ??
    "Flagged notebook review finding"
  );
}


export function summarizeGuidance(
  guidance: ReviewSnapshotRecord["reviewer_guidance"][number],
): string {
  return (
    guidance.prompt ??
    guidance.label ??
    guidance.source ??
    "Reviewer guidance"
  );
}


export function summarizeGitHubMirrorStatus(
  thread: ReviewThread,
): {
  label: string;
  tone: "default" | "accent" | "success" | "warning" | "danger";
  description: string;
  linkLabel: string | null;
} {
  if (thread.github_mirror_state === "pending") {
    return {
      label: "GitHub sync pending",
      tone: "accent",
      description:
        "NotebookLens recorded this thread first and is still waiting to mirror it to GitHub.",
      linkLabel: null,
    };
  }

  if (thread.github_mirror_state === "mirrored") {
    return {
      label: "Mirrored to GitHub",
      tone: "success",
      description: thread.github_root_comment_url
        ? "GitHub reviewers can open the mirrored PR thread directly."
        : "GitHub mirror activity exists, but this thread does not expose a direct PR comment link yet.",
      linkLabel: thread.github_root_comment_url ? "Open mirrored PR thread" : null,
    };
  }

  if (thread.github_mirror_state === "failed") {
    return {
      label: "GitHub sync failed",
      tone: "danger",
      description:
        "NotebookLens remains the source of truth while GitHub mirroring needs attention.",
      linkLabel: null,
    };
  }

  if (thread.github_mirror_state === "skipped") {
    return {
      label: "GitHub sync skipped",
      tone: "warning",
      description:
        "This hosted anchor was not mirrored into a native GitHub PR comment, so continue in NotebookLens.",
      linkLabel: null,
    };
  }

  return {
    label: "GitHub sync not recorded",
    tone: "default",
    description:
      "Mirror status metadata is not available for this thread yet. NotebookLens remains the canonical discussion surface.",
    linkLabel: null,
  };
}


function firstValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}


function normalizeSummary(summary: string): string {
  return summary
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/g, "");
}


function hasMeaningfulText(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}


export function formatOutputMimeLabel(mimeType: string): string {
  const normalized = mimeType.toLowerCase();
  if (normalized === "stream") {
    return "Stream";
  }
  if (normalized === "error") {
    return "Error";
  }
  if (normalized.endsWith("json")) {
    return "JSON";
  }
  if (normalized.includes("plain")) {
    return "Text";
  }
  return mimeType;
}


/**
 * Pretty-prints bounded JSON text output for display. Parsing is used only
 * to format the already-received text, never to evaluate it; any parse
 * failure falls back to the original text unchanged.
 */
export function formatTextOutput(text: string, mimeType: string): string {
  const normalized = mimeType.toLowerCase();
  if (!normalized.endsWith("json")) {
    return text;
  }
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}
