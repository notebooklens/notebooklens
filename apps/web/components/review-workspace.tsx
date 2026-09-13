"use client";

import type { Route } from "next";
import Image from "next/image";
import Link from "next/link";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { buildApiHref, buildLoginHref } from "@/lib/public-hrefs";
import { computeLineDiff, type DiffLine } from "@/lib/code-diff";
import { buildSandboxedHtmlDocument } from "@/lib/html-output";
import { InteractiveOutputFrame } from "@/components/interactive-output-frame";
import { ThreadMutationForm } from "@/components/thread-mutation-form";
import {
  buildAnchorKey,
  buildAiGatewayRoute,
  buildSnapshotRoute,
  buildWorkspaceActionPath,
  canStartThread,
  formatCellLabel,
  formatOutputMimeLabel,
  formatTextOutput,
  getMeaningfulOutputItems,
  getVisibleBlockKinds,
  groupThreadsByAnchor,
  hasMeaningfulBlockContent,
  isBlockChanged,
  summarizeGitHubMirrorStatus,
  toggleThreadComposer,
} from "@/lib/review-workspace";
import type {
  FlashNotice,
  RenderRow,
  RenderOutputItem,
  ReviewSnapshotRecord,
  ReviewThread,
  SnapshotBlockKind,
  SnapshotNotebook,
  ThreadAnchor,
  WorkspacePayload,
} from "@/lib/types";


type ReviewWorkspaceProps = {
  workspace: WorkspacePayload;
  currentPath: string;
  flashNotice: FlashNotice | null;
};

const WORKSPACE_TOP_ID = "review-workspace-top";
const SNAPSHOT_HISTORY_ID = "workspace-snapshot-history";
const ViewPreferences = createContext({ showPrevious: true, showOutputs: true });
const CommentDrafts = createContext<Map<string, string> | null>(null);

type RailJumpTarget = {
  id: string;
  label: string;
  caption: string;
};

type RailNavigationData = {
  notebookTargets: RailJumpTarget[];
  threadTargets: RailJumpTarget[];
  outputTargets: RailJumpTarget[];
  orderedOpenThreads: ReviewThread[];
};


export function ReviewWorkspace({
  workspace,
  currentPath,
  flashNotice,
}: ReviewWorkspaceProps) {
  const snapshot = workspace.snapshot;
  const commentDrafts = useRef(new Map<string, string>());
  const [activeView, setActiveView] = useState<"changes" | "discussions">("changes");
  const [showPrevious, setShowPrevious] = useState(true);
  const [showOutputs, setShowOutputs] = useState(true);
  const availableAnchors = new Set(snapshot?.status === "ready" ? snapshot.payload.review.notebooks.flatMap((notebook) => notebook.render_rows.flatMap((row) => Object.values(row.thread_anchors).map(buildAnchorKey))) : []);
  const unmatchedThreads = workspace.threads.filter((thread) => thread.anchor.block_kind !== "metadata" && (thread.anchor_drifted || !availableAnchors.has(buildAnchorKey(thread.anchor))));
  const unmatchedIds = new Set(unmatchedThreads.map((thread) => thread.id));
  const threadsByAnchor = groupThreadsByAnchor(workspace.threads.filter((thread) => thread.anchor.block_kind !== "metadata" && !unmatchedIds.has(thread.id)));
  const openThreads = workspace.threads.filter((thread) => thread.status === "open" && thread.anchor.block_kind !== "metadata");
  const [openComposerKey, setOpenComposerKey] = useState<string | null>(null);
  const visibleNotebooks = snapshot?.status === "ready"
    ? snapshot.payload.review.notebooks.filter(
        (notebook) =>
          notebook.notices.length > 0 ||
          notebook.render_rows.some((row) => hasVisibleReviewBlocks(row, threadsByAnchor)),
      )
    : [];
  const railNavigation = collectRailNavigationData(visibleNotebooks, threadsByAnchor);
  const primaryOpenThread = railNavigation.orderedOpenThreads[0] ?? openThreads[0] ?? null;
  const latestSnapshotLabel =
    workspace.review.latest_snapshot_index === null
      ? "No push ready yet"
      : `Latest push ${workspace.review.latest_snapshot_index}`;
  const selectedSnapshotLabel =
    snapshot === null
      ? "No push selected"
      : snapshot.snapshot_index === workspace.review.latest_snapshot_index
        ? "Reviewing latest push"
        : `Reviewing push ${snapshot.snapshot_index}`;
  const reviewStatusLabel = formatReviewStatusLabel(workspace.review.status);
  const installationLabel = `${workspace.review.installation.account_login} (${workspace.review.installation.account_type})`;

  useEffect(() => {
    setOpenComposerKey(null);
    commentDrafts.current.clear();
  }, [snapshot?.id]);

  useEffect(() => {
    const reveal = () => {
      const target = document.getElementById(window.location.hash.slice(1));
      if (!target) return;
      if (target.closest("[data-review-changes]")) setActiveView("changes");
      if (target.closest(".discussion-index")) setActiveView("discussions");
      revealFragment(target.id);
      window.requestAnimationFrame(() => revealFragment(target.id));
    };
    reveal();
    window.addEventListener("hashchange", reveal);
    return () => window.removeEventListener("hashchange", reveal);
  }, [snapshot?.id]);

  return (
    <CommentDrafts.Provider value={commentDrafts.current}><ViewPreferences.Provider value={{ showPrevious, showOutputs }}><div className="workspace-shell notebook-document-workspace" id={WORKSPACE_TOP_ID} onClick={(event) => {
      const link = (event.target as Element).closest("a[href^='#']");
      const fragment = link?.getAttribute("href")?.slice(1);
      if (fragment) {
        if (document.getElementById(fragment)?.closest("[data-review-changes]")) setActiveView("changes");
        revealFragment(fragment);
      }
    }}>
      <header className="summary-card workspace-pr-strip">
        <div className="workspace-pr-strip-main">
          <p className="workspace-breadcrumb">
            NotebookLens review workspace
          </p>
          <div className="workspace-pr-strip-head">
            <h1 className="workspace-title workspace-title-compact">
              {workspace.review.owner}/{workspace.review.repo}
            </h1>
            <span className="workspace-pr-number">
              PR #{workspace.review.pull_number}
            </span>
            <span className="workspace-pr-installation">
              {installationLabel}
            </span>
          </div>
        </div>
        <div className="workspace-pr-strip-meta">
          <div className="hero-meta workspace-meta">
            <StatusPill label={reviewStatusLabel} tone="default" />
            <StatusPill label={selectedSnapshotLabel} tone="default" />
            <StatusPill
              label={`${workspace.review.thread_counts.unresolved} open`}
              tone="accent"
            />
          </div>
          <p className="workspace-strip-caption workspace-strip-caption-inline">
            {latestSnapshotLabel} · {workspace.review.thread_counts.resolved} resolved ·{" "}
            {workspace.review.thread_counts.outdated} outdated
          </p>
        </div>
      </header>

      {flashNotice ? (
        <div className={`flash-banner flash-${flashNotice.tone}`}>
          {flashNotice.message}
        </div>
      ) : null}

      <nav className="review-toolbar" aria-label="Review views">
        <button type="button" aria-pressed={activeView === "changes"} onClick={() => setActiveView("changes")}>Changes</button>
        <button type="button" aria-pressed={activeView === "discussions"} onClick={() => setActiveView("discussions")}>Discussions ({workspace.threads.length})</button>
        <label><input type="checkbox" checked={showPrevious} onChange={(event) => setShowPrevious(event.target.checked)} /> Show previous version</label>
        <label><input type="checkbox" checked={showOutputs} onChange={(event) => setShowOutputs(event.target.checked)} /> Show outputs</label>
      </nav>
      <main hidden={activeView !== "discussions"} className="discussion-index" aria-label="Review discussions">
        <h2>Discussions on this push</h2>
        {workspace.threads.length ? workspace.threads.map((thread) => <article key={thread.id}><p>{thread.anchor.notebook_path} · {formatThreadAnchorSummary(thread.anchor)}{thread.anchor_drifted || unmatchedIds.has(thread.id) ? " · Anchor needs review" : ""}</p><ThreadCard thread={thread} currentPath={currentPath} surface="index" /></article>) : <p>No discussions yet. Start one beside a cell in Changes.</p>}
      </main><div hidden={activeView !== "changes"} data-review-changes className="workspace-grid">
        <main className="workspace-main">
          {snapshot ? (
            <SnapshotOverview review={workspace.review} snapshot={snapshot} visibleNotebooks={visibleNotebooks} />
          ) : (
            <EmptyState
              title="This review is not ready yet"
              description="Open the PR check run again after NotebookLens finishes loading the latest push."
            />
          )}

          {snapshot?.status === "failed" ? (
            <EmptyState
              title="NotebookLens could not prepare this review"
              description={snapshot.failure_reason ?? "Try reopening the PR check run after the latest push finishes."}
            />
          ) : null}

          {snapshot?.status === "ready" &&
          visibleNotebooks.length > 0 ? (
            <section className="notebook-stack">
              {visibleNotebooks.length > 1 ? (
                <details className="summary-card notebook-jump-card">
                  <summary className="notebook-jump-summary">
                    <span>
                      <strong>Jump between notebooks</strong>
                      <span className="history-caption notebook-jump-summary-copy">
                        {visibleNotebooks.length} changed notebooks
                      </span>
                    </span>
                    <span className="muted-copy">
                      Open navigator
                    </span>
                  </summary>
                  <div className="notebook-jump-grid">
                    {visibleNotebooks.map((notebook) => {
                      const [directoryLabel, fileLabel] = splitNotebookPath(notebook.path);
                      const reviewItemCount = notebook.render_rows.filter((row) =>
                        hasVisibleReviewBlocks(row, threadsByAnchor),
                      ).length;
                      const threadCount = countThreadsForNotebook(notebook, threadsByAnchor);

                      return (
                        <a
                          className="history-link notebook-jump-link"
                          href={`#${buildNotebookSectionId(notebook.path)}`}
                          key={`jump-${notebook.path}`}
                        >
                          <span className="notebook-jump-copy">
                            <strong>{fileLabel}</strong>
                            <span className="history-caption">{directoryLabel}</span>
                          </span>
                          <span className="notebook-jump-meta">
                            <span>{reviewItemCount} items</span>
                            <span>{threadCount} threads</span>
                          </span>
                        </a>
                      );
                    })}
                  </div>
                </details>
              ) : null}
              {visibleNotebooks.map((notebook) => (
                <NotebookCard
                  currentPath={currentPath}
                  key={`${notebook.path}-${snapshot.id}`}
                  notebook={notebook}
                  onToggleComposer={(composerKey) => {
                    setOpenComposerKey((currentComposerKey) =>
                      toggleThreadComposer(currentComposerKey, composerKey),
                    );
                  }}
                  openComposerKey={openComposerKey}
                  reviewId={workspace.review.id}
                  review={workspace.review}
                  snapshot={snapshot}
                  threadsByAnchor={threadsByAnchor}
                />
              ))}
            </section>
          ) : null}

          {snapshot?.status === "ready" &&
          visibleNotebooks.length === 0 ? (
            <EmptyState
              title="No code or output changes on this push"
              description="Existing conversations remain available in Discussions. Choose another push to compare a different update."
            />
          ) : null}
          {unmatchedThreads.length ? (
            <section className="summary-card" aria-label="Discussions needing anchor review">
              <h2>Discussions needing anchor review ({unmatchedThreads.length})</h2>
              <p>These discussions could not be confidently placed on this push. Their original context is preserved below.</p>
              {unmatchedThreads.map((thread) => <div key={thread.id}><p>{thread.anchor.notebook_path} · {formatThreadAnchorSummary(thread.anchor)}</p><ThreadCard currentPath={currentPath} thread={thread} /></div>)}
            </section>
          ) : null}
        </main>

        <aside className="workspace-sidebar">
          <details className="review-navigation-disclosure"><summary>Navigate changes and discussions</summary>
          {snapshot?.status === "ready" ? (
            <QuickJumpRailCard
              notebookTargets={railNavigation.notebookTargets}
              outputTargets={railNavigation.outputTargets}
              threadTargets={railNavigation.threadTargets}
            />
          ) : null}

          {primaryOpenThread ? (
            <OpenThreadRailCard
              openThreadCount={openThreads.length}
              thread={primaryOpenThread}
            />
          ) : null}

          </details>
          <SnapshotHistoryRailCard review={workspace.review} />
        </aside>
      </div>

      <details className="summary-card workspace-utility-card">
        <summary className="workspace-utility-summary">
          <span>
            <strong>Sign-in &amp; team settings</strong>
            <span className="history-caption notebook-jump-summary-copy">
              Keep these nearby without interrupting the diff.
            </span>
          </span>
          <span className="muted-copy">Open only if needed</span>
        </summary>
        <div className="workspace-utility-panel">
          <p className="muted-copy">
            Refresh GitHub access, sign out, or adjust team AI settings for{" "}
            {installationLabel}.
          </p>
          <div className="workspace-utility-actions">
            <a className="secondary-button" href={buildLoginHref(currentPath)}>
              Refresh GitHub access
            </a>
            <form action={buildWorkspaceActionPath("logout")} method="post">
              <input name="returnTo" type="hidden" value={currentPath} />
              <button className="ghost-button" type="submit">
                Sign out
              </button>
            </form>
            <Link
              className="text-link"
              href={
                buildAiGatewayRoute(
                  workspace.review.owner,
                  workspace.review.repo,
                  workspace.review.pull_number,
                ) as Route
              }
            >
              Open team AI settings
            </Link>
          </div>
        </div>
      </details>
    </div></ViewPreferences.Provider></CommentDrafts.Provider>
  );
}


type SnapshotOverviewProps = {
  visibleNotebooks: SnapshotNotebook[];
  review: WorkspacePayload["review"];
  snapshot: ReviewSnapshotRecord;
};


function SnapshotOverview({ review, snapshot, visibleNotebooks }: SnapshotOverviewProps) {
  const changedRows = visibleNotebooks.map((notebook) => notebook.render_rows.filter((row) => (["source", "outputs"] as const).some((kind) => isBlockChanged(row, kind) && hasMeaningfulBlockContent(row, kind))));
  const changedNotebookCount = changedRows.filter((rows) => rows.length > 0).length;
  const changedCellCount = changedRows.reduce((count, rows) => count + rows.length, 0);

  return (
    <section className="summary-card snapshot-overview-card">
      <div className="summary-head snapshot-overview-head">
        <div>
          <p className="summary-text snapshot-summary-kicker">
            Push {snapshot.snapshot_index} ·{" "}
            {changedNotebookCount} notebook{changedNotebookCount === 1 ? "" : "s"} with code/output changes ·{" "}
            {changedCellCount} changed cell
            {changedCellCount === 1 ? "" : "s"}
          </p>
        </div>
        {snapshot.status !== "ready" ? <span>{formatSnapshotStatusLabel(snapshot.status)}</span> : null}
      </div>
      {snapshot.summary_text ? (
        <p className="summary-text snapshot-summary-text">{snapshot.summary_text}</p>
      ) : null}
      {snapshot.payload.review.notices.map((notice) => (
        <p className="muted-copy" role="note" key={notice}>{notice}</p>
      ))}
      <details className="snapshot-disclosure">
        <summary>Push details</summary>
        <div className="snapshot-disclosure-panel">
          <div className="snapshot-strip snapshot-context-strip">
            <span>Prepared {formatTimestamp(snapshot.created_at)}</span>
            <span>
              {review.base_branch} · {snapshot.base_sha.slice(0, 12)} {"->"} {snapshot.head_sha.slice(0, 12)}
            </span>
          </div>
          <div className="snapshot-overview-stats">
            <div className="summary-metric snapshot-metric">
              <span className="summary-label">PR</span>
              <strong>#{review.pull_number}</strong>
            </div>
            <div className="summary-metric snapshot-metric">
              <span className="summary-label">Compared against</span>
              <strong>{review.base_branch}</strong>
            </div>
            <div className="summary-metric snapshot-metric">
              <span className="summary-label">Latest commit in view</span>
              <strong>{snapshot.head_sha.slice(0, 12)}</strong>
            </div>
            <div className="summary-metric snapshot-metric">
              <span className="summary-label">Thread status</span>
              <strong>
                {review.thread_counts.unresolved} open · {review.thread_counts.resolved} resolved
              </strong>
            </div>
          </div>
        </div>
      </details>
    </section>
  );
}


type NotebookCardProps = {
  review: WorkspacePayload["review"];
  reviewId: string;
  snapshot: ReviewSnapshotRecord;
  notebook: SnapshotNotebook;
  threadsByAnchor: Map<string, ReviewThread[]>;
  currentPath: string;
  openComposerKey: string | null;
  onToggleComposer: (composerKey: string) => void;
};


function NotebookCard({
  review,
  reviewId,
  snapshot,
  notebook,
  threadsByAnchor,
  currentPath,
  openComposerKey,
  onToggleComposer,
}: NotebookCardProps) {
  const [directoryLabel, fileLabel] = splitNotebookPath(notebook.path);
  const notebookThreads = getThreadsForNotebook(notebook, threadsByAnchor);
  const openThreadCount = notebookThreads.filter((thread) => thread.status === "open").length;
  const visibleRows = notebook.render_rows.filter((row) => hasVisibleReviewBlocks(row, threadsByAnchor));
  const notebookSectionId = buildNotebookSectionId(notebook.path);
  const notebookReviewSummary = buildNotebookReviewSummary({
    firstVisibleRow: visibleRows[0] ?? null,
    reviewItemCount: visibleRows.length,
    noticeCount: notebook.notices.length,
    openThreadCount,
  });
  const notebookNotesLabel = `${notebook.notices.length} notebook ${pluralize(
    notebook.notices.length,
    "note",
  )}`;

  return (
    <details open className="notebook-card notebook-card-flat" id={notebookSectionId}>
      <summary className="notebook-head">
        <div>
          <h2>{fileLabel}</h2>
          <p className="notebook-subpath">{directoryLabel}</p>
        </div>
        <StatusPill label={formatChangeTypeLabel(notebook.change_type)} tone={outputChangeTone(notebook.change_type)} />
      </summary>

      <p className="notebook-review-summary">{notebookReviewSummary}</p>

      {notebook.notices.length ? (
        <details className="notebook-summary-card">
          <summary className="notebook-summary-toggle">
            <span>
              <strong>Notebook notes</strong>
              <span className="history-caption notebook-jump-summary-copy">
                {notebookNotesLabel}
              </span>
            </span>
            <span className="muted-copy">Open only if needed</span>
          </summary>
          <div className="notebook-summary-panel">
            <div className="notebook-summary-section">
              <ul className="chip-list">
                {notebook.notices.map((notice) => (
                  <li className="chip-item" key={notice}>
                    {notice}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </details>
      ) : null}

      <div className="row-stack">
        {visibleRows.map((row) => (
          <CellRowCard
            currentPath={currentPath}
            key={`${notebook.path}-${buildAnchorKey(row.thread_anchors.source)}`}
            onToggleComposer={onToggleComposer}
            openComposerKey={openComposerKey}
            review={review}
            reviewId={reviewId}
            row={row}
            snapshot={snapshot}
            threadsByAnchor={threadsByAnchor}
          />
        ))}
      </div>
    </details>
  );
}


function OpenThreadRailCard({
  thread,
  openThreadCount,
}: {
  thread: ReviewThread;
  openThreadCount: number;
}) {
  const [directoryLabel, fileLabel] = splitNotebookPath(thread.anchor.notebook_path);

  return (
    <section className="side-card side-card-compact">
      <div className="sidebar-rail-head">
        <h2>{openThreadCount === 1 ? "Open thread" : "Open threads"}</h2>
        <StatusPill label={`${openThreadCount} open`} tone="accent" />
      </div>
      <p className="muted-copy side-card-copy">
        {openThreadCount === 1
          ? "Jump back into the active discussion without scanning the full diff."
          : "Showing one active discussion so the rail stays compact."}
      </p>
      <a
        className="history-link rail-thread-link"
        href={`#${buildThreadSectionId(thread.id)}`}
      >
        <span className="notebook-jump-copy">
          <strong>{fileLabel}</strong>
          <span className="history-caption">{directoryLabel}</span>
        </span>
        <span className="history-caption">{formatThreadAnchorSummary(thread.anchor)}</span>
      </a>
      <p className="thread-preview rail-thread-preview">{summarizeThreadPreview(thread)}</p>
    </section>
  );
}


type CellRowCardProps = {
  review: WorkspacePayload["review"];
  reviewId: string;
  snapshot: ReviewSnapshotRecord;
  row: RenderRow;
  threadsByAnchor: Map<string, ReviewThread[]>;
  currentPath: string;
  openComposerKey: string | null;
  onToggleComposer: (composerKey: string) => void;
};


function CellRowCard({
  review,
  reviewId,
  snapshot,
  row,
  threadsByAnchor,
  currentPath,
  openComposerKey,
  onToggleComposer,
}: CellRowCardProps) {
  const blocks = getReviewBlockKinds(row, threadsByAnchor);

  return (
    <article className="cell-card cell-card-flat">
      <div className="cell-card-head cell-card-head-compact">
        <h3 className="cell-row-heading">
          <span>{formatCellLabel(row)}</span>
          <span className="cell-row-heading-divider">·</span>
          <span className="cell-row-heading-detail">{formatCellTypeLabel(row.cell_type)}</span>
        </h3>
        <div className="cell-card-meta cell-card-meta-inline">
          <StatusPill label={formatRowChangeLabel(row.change_type)} tone={outputChangeTone(row.change_type)} />
          {row.change_type === "moved" && row.locator.base_index !== null && row.locator.head_index !== null ? <span>Cell {row.locator.base_index + 1} → {row.locator.head_index + 1}</span> : null}
        </div>
      </div>

      <div className="block-stack">
        {blocks.map((blockKind) => {
          const anchor = row.thread_anchors[blockKind];
          const composerKey = buildAnchorKey(anchor);
          const composerId = buildThreadComposerId(anchor);
          const composerOpen = openComposerKey === composerKey;
          const threads = threadsByAnchor.get(buildAnchorKey(anchor)) ?? [];
          const threadable = canStartThread(review, snapshot, row, blockKind);

          const content = (
            <section
              className="diff-block diff-block-flat"
              id={buildBlockSectionId(anchor)}
              key={blockKind}
            >
              <div className="diff-block-head">
                <h4>{blockTitle(blockKind)}</h4>
                <div className="diff-block-meta">
                  {threads.length ? (
                    <StatusPill label={`${threads.length} thread${threads.length === 1 ? "" : "s"}`} tone="default" />
                  ) : null}
                  {threadable ? (
                    <button
                      aria-label={`Add comment on ${formatCellLabel(row)} ${blockTitle(blockKind).toLowerCase()}`}
                      aria-controls={composerId}
                      aria-expanded={composerOpen}
                      className={`${composerOpen ? "secondary-button" : "ghost-button"} thread-affordance-button`}
                      onClick={() => onToggleComposer(composerKey)}
                      type="button"
                    >
                      {composerOpen ? "−" : "+"}
                    </button>
                  ) : null}
                </div>
              </div>

              <BlockContent blockKind={blockKind} row={row} />

              <ThreadColumn
                anchor={anchor}
                composerId={composerId}
                composerOpen={composerOpen}
                currentPath={`${currentPath.split("#")[0]}#${buildBlockSectionId(anchor)}`}
                onCancelComposer={() => onToggleComposer(composerKey)}
                reviewId={reviewId}
                snapshotId={snapshot.id}
                threadable={threadable}
                threads={threads}
              />
            </section>
          );
          return content;
        })}
      </div>
    </article>
  );
}


function BlockContent({
  blockKind,
  row,
}: {
  blockKind: SnapshotBlockKind;
  row: RenderRow;
}) {
  const { showPrevious, showOutputs } = useContext(ViewPreferences);
  const removed = row.change_type === "deleted" || row.change_type === "removed";
  if (!hasMeaningfulBlockContent(row, blockKind)) {
    return null;
  }

  if (blockKind === "source") {
    if (row.change_type === "added" || removed || !showPrevious) {
      const value = removed ? row.source.base : row.source.head;
      const label = removed ? "Removed cell" : row.change_type === "added" ? "Added cell" : "Current version";
      const singleDiff = computeLineDiff(row.source.base, row.source.head);
      const lines = row.change_type === "added" || removed ? value?.split("\n").map((content, index) => ({ content, lineNumber: index + 1, status: removed ? "removed" as const : "added" as const })) : singleDiff.headLines;
      return row.cell_type === "markdown" ? <MarkdownPane label={label} value={value} change={removed ? "removed" : row.change_type === "added" ? "added" : undefined} /> : <>{!singleDiff.bounded && row.change_type !== "added" && !removed ? <p role="note">Large cell: showing full source without computed change highlighting.</p> : null}<CodePane label={label} value={value} diffLines={lines} /></>;
    }
    if (row.cell_type === "markdown") {
      return (
        <div className="code-grid">
          <MarkdownPane label="Before" value={row.source.base} />
          <MarkdownPane label="After" value={row.source.head} />
        </div>
      );
    }
    const lineDiff = computeLineDiff(row.source.base, row.source.head);
    return (
      <>
        {!lineDiff.bounded ? <p role="note">Large cell: showing full source without computed change highlighting. Rows are positioned for reading, not matched changes.</p> : null}
        <div className="code-grid aligned-code-grid">
          <CodePane diffLines={lineDiff.alignedRows.map((line) => line.base)} label="Before" value={row.source.base} />
          <CodePane diffLines={lineDiff.alignedRows.map((line) => line.head)} label="After" value={row.source.head} />
        </div>
      </>
    );
  }

  if (blockKind === "outputs") {
    const outputItems = getMeaningfulOutputItems(row);
    if (row.change_type === "added" || removed) {
      const side = removed ? "base" : "head";
      return <>{!showOutputs ? <p className="muted-copy">Outputs hidden. Enable Show outputs to inspect them; discussions remain below.</p> : null}<div hidden={!showOutputs} className="output-list">{outputItems.filter((item) => !item.side || item.side === side).map((item, index) => <OutputItemCard key={`${item.kind}-${index}`} item={item} />)}</div></>;
    }

    return (
      <>{!showOutputs ? <p className="muted-copy">Outputs hidden. Enable Show outputs to inspect them; discussions remain below.</p> : null}<div hidden={!showOutputs} className="output-comparison">
        {outputItems.some((item) => item.side) ? <div className={`output-side-grid${showPrevious ? "" : " output-current-only"}`}>{(["base", "head"] as const).map((side) => (
          <section hidden={side === "base" && !showPrevious} className="output-side" key={side} aria-label={`${side === "base" ? "Before" : "After"} outputs`}>
            <h5>{side === "base" ? "Before" : "After"}</h5>
            {outputItems.filter((item) => item.side === side).length ? outputItems.filter((item) => item.side === side).map((item, index) => <OutputItemCard item={item} key={`${item.kind}-${index}`} />) : <p className="muted-copy">No saved output on this side.</p>}
          </section>
        ))}</div> : null}
        {outputItems.some((item) => !item.side) ? <section className="output-list" aria-label="Outputs without comparison side"><h5>Saved outputs · comparison side unavailable</h5>{outputItems.filter((item) => !item.side).map((item, index) => <OutputItemCard item={item} key={`${item.kind}-${index}`} />)}</section> : null}
      </div></>
    );
  }

  return null;
}


function OutputItemCard({ item }: { item: RenderOutputItem }) {
  if (item.kind === "image") {
    return <ImageOutputCard item={item} />;
  }
  if (item.kind === "text") {
    return <TextOutputCard item={item} />;
  }
  if (item.kind === "html") {
    return <HtmlOutputCard item={item} />;
  }
  if (item.kind === "plotly") {
    return <PlotlyOutputCard item={item} />;
  }
  if (item.kind === "widget") {
    return <WidgetOutputCard item={item} />;
  }
  return (
    <article className="output-card">
      <div className="output-head">
        <strong>{item.output_type}</strong>
        <div className="output-meta">
          <OutputSideBadge side={item.side} />
          <span>{item.mime_group}</span>
          <StatusPill label={item.change_type} tone={outputChangeTone(item.change_type)} />
        </div>
      </div>
      <p>{item.summary}</p>
      {item.truncated ? <span className="muted-copy">Output summary truncated</span> : null}
    </article>
  );
}


function OutputSideBadge({ side }: { side?: "base" | "head" }) {
  if (!side) {
    return null;
  }
  return <StatusPill label={side === "base" ? "Base" : "Head"} tone="default" />;
}


function ImageOutputCard({
  item,
}: {
  item: Extract<RenderRow["outputs"]["items"][number], { kind: "image" }>;
}) {
  return (
    <article className="output-card image-output-card">
      <div className="output-head">
        <strong>Notebook image output</strong>
        <div className="output-meta">
          <OutputSideBadge side={item.side} />
          <span>{item.mime_type}</span>
          <StatusPill label={item.change_type} tone={outputChangeTone(item.change_type)} />
        </div>
      </div>
      <div className="output-image-frame">
        <Image
          alt={`Notebook output image (${item.mime_type})`}
          className="output-image"
          height={item.height ?? 675}
          loading="lazy"
          src={buildApiHref(`/api/review-assets/${item.asset_id}`)}
          unoptimized
          width={item.width ?? 1200}
        />
      </div>
      <p className="muted-copy">
        {item.width && item.height
          ? `${item.width} x ${item.height} px`
          : "Dimensions unavailable"}
      </p>
    </article>
  );
}


function TextOutputCard({
  item,
}: {
  item: Extract<RenderRow["outputs"]["items"][number], { kind: "text" }>;
}) {
  const pretty = formatTextOutput(item.text, item.mime_type);

  return (
    <article className="output-card text-output-card">
      <div className="output-head">
        <strong>{formatOutputMimeLabel(item.mime_type)} output</strong>
        <div className="output-meta">
          <OutputSideBadge side={item.side} />
          <StatusPill label={item.change_type} tone={outputChangeTone(item.change_type)} />
        </div>
      </div>
      <pre className="output-text-pane">{pretty}</pre>
      {item.truncated ? <span className="muted-copy">Output text truncated</span> : null}
    </article>
  );
}


function HtmlOutputCard({
  item,
}: {
  item: Extract<RenderRow["outputs"]["items"][number], { kind: "html" }>;
}) {
  const srcDoc = buildSandboxedHtmlDocument(item.html);

  return (
    <article className="output-card html-output-card">
      <div className="output-head">
        <strong>HTML output</strong>
        <div className="output-meta">
          <OutputSideBadge side={item.side} />
          <StatusPill label={item.change_type} tone={outputChangeTone(item.change_type)} />
        </div>
      </div>
      <iframe
        className="html-output-frame"
        referrerPolicy="no-referrer"
        sandbox=""
        srcDoc={srcDoc}
        title="Notebook HTML output"
      />
      {item.truncated ? <span className="muted-copy">Output HTML truncated</span> : null}
    </article>
  );
}


function PlotlyOutputCard({
  item,
}: {
  item: Extract<RenderRow["outputs"]["items"][number], { kind: "plotly" }>;
}) {
  return (
    <article className="output-card plotly-output-card">
      <div className="output-head">
        <strong>Plotly figure</strong>
        <div className="output-meta">
          <OutputSideBadge side={item.side} />
          <StatusPill label={item.change_type} tone={outputChangeTone(item.change_type)} />
        </div>
      </div>
      <InteractiveOutputFrame item={item} />
    </article>
  );
}


function WidgetOutputCard({
  item,
}: {
  item: Extract<RenderRow["outputs"]["items"][number], { kind: "widget" }>;
}) {
  return (
    <article className="output-card widget-output-card">
      <div className="output-head">
        <strong>Saved widget</strong>
        <div className="output-meta">
          <OutputSideBadge side={item.side} />
          <StatusPill label={item.change_type} tone={outputChangeTone(item.change_type)} />
        </div>
      </div>
      <InteractiveOutputFrame item={item} />
    </article>
  );
}


function CodePane({
  label,
  value,
  diffLines,
}: {
  label: string;
  value: string | null;
  diffLines?: (DiffLine | null)[];
}) {
  if ((!value || value.length === 0) && !diffLines?.length) {
    return (
      <div className="code-pane">
        <span className="code-pane-label">{label}</span>
        <pre>{value === null ? "Cell not present on this side." : "Empty source."}</pre>
      </div>
    );
  }

  return (
    <div className="code-pane">
      <span className="code-pane-label">{label}</span>
      <pre className="code-pane-diff">
        {(diffLines ?? []).map((line, index) => (
          <span className={`code-diff-line code-diff-line-${line?.status ?? "placeholder"}`} key={index}>
            <span className="code-diff-line-number">{line?.lineNumber ?? " "}</span>
            <span className="code-diff-line-marker" aria-label={line?.status === "added" ? "Added" : line?.status === "removed" ? "Removed" : undefined}>{line?.status === "added" ? "+" : line?.status === "removed" ? "−" : " "}</span>
            <span className="code-diff-line-content">{line?.content || " "}</span>
          </span>
        ))}
      </pre>
    </div>
  );
}


function MarkdownPane({
  label,
  value,
  change,
}: {
  label: string;
  value: string | null;
  change?: "added" | "removed";
}) {
  return (
    <div className={`code-pane markdown-pane${change ? ` markdown-pane-${change}` : ""}`}>
      {change ? <span className="markdown-change-marker" aria-hidden="true">{change === "added" ? "+" : "−"}</span> : null}
      <span className="code-pane-label">{label}</span>
      {value && value.length > 0 ? (
        <div className="markdown-body">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{value}</ReactMarkdown>
        </div>
      ) : (
        <p className="muted-copy">{value === null ? "Cell not present on this side." : "Empty source."}</p>
      )}
    </div>
  );
}


type ThreadColumnProps = {
  reviewId: string;
  snapshotId: string;
  anchor: ThreadAnchor;
  threads: ReviewThread[];
  threadable: boolean;
  currentPath: string;
  composerOpen: boolean;
  composerId: string;
  onCancelComposer: () => void;
};


function ThreadColumn({
  reviewId,
  snapshotId,
  anchor,
  threads,
  threadable,
  currentPath,
  composerOpen,
  composerId,
  onCancelComposer,
}: ThreadColumnProps) {
  const showThreadingNote = !threadable && threads.length === 0;

  return (
    <div className="thread-column">
      {threadable && composerOpen ? (
        <InlineThreadComposer
          anchor={anchor}
          composerId={composerId}
          currentPath={currentPath}
          onCancel={onCancelComposer}
          reviewId={reviewId}
          snapshotId={snapshotId}
        />
      ) : null}

      {showThreadingNote ? (
        <p className="muted-copy">
          New threads can only start on changed areas in the latest ready push.
        </p>
      ) : null}

      {threads.length ? (
        <div className="thread-stack">
          {threads.map((thread) => (
            <ThreadCard currentPath={currentPath} key={thread.id} thread={thread} />
          ))}
        </div>
      ) : null}
    </div>
  );
}


function InlineThreadComposer({
  reviewId,
  snapshotId,
  anchor,
  currentPath,
  composerId,
  onCancel,
}: {
  reviewId: string;
  snapshotId: string;
  anchor: ThreadAnchor;
  currentPath: string;
  composerId: string;
  onCancel: () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const drafts = useContext(CommentDrafts);
  const draftKey = `${snapshotId}:${buildAnchorKey(anchor)}`;

  useEffect(() => {
    const focusHandle = window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });

    return () => {
      window.cancelAnimationFrame(focusHandle);
    };
  }, []);

  return (
    <ThreadMutationForm
      action={buildWorkspaceActionPath("create-thread")}
      className="thread-form thread-form-inline"
      id={composerId}
      method="post"
      onSuccess={() => drafts?.delete(draftKey)}
    >
      <input name="returnTo" type="hidden" value={currentPath} />
      <input name="reviewId" type="hidden" value={reviewId} />
      <input name="snapshotId" type="hidden" value={snapshotId} />
      <input name="anchorJson" type="hidden" value={JSON.stringify(anchor)} />
      <div className="thread-form-inline-head">
        <strong>Start a thread</strong>
        <span className="muted-copy">Keep it attached to this block.</span>
      </div>
      <textarea
        autoFocus
        aria-label="New discussion comment"
        name="bodyMarkdown"
        defaultValue={drafts?.get(draftKey) ?? ""}
        onChange={(event) => drafts?.set(draftKey, event.target.value)}
        placeholder="Ask for context, call out a regression, or note the follow-up you want here."
        ref={textareaRef}
        required
        rows={3}
      />
      <div className="thread-form-actions">
        <span className="muted-copy">Posts to this review block.</span>
        <button className="ghost-button thread-inline-button" onClick={() => { drafts?.delete(draftKey); onCancel(); }} type="button">
          Cancel
        </button>
        <button className="primary-button thread-inline-button" type="submit">
          Comment
        </button>
      </div>
    </ThreadMutationForm>
  );
}


function ThreadCard({
  thread,
  currentPath,
  surface = "changes",
}: {
  thread: ReviewThread;
  currentPath: string;
  surface?: "changes" | "index";
}) {
  const mirrorStatus = summarizeGitHubMirrorStatus(thread);
  const authorLabel = thread.messages[0]?.author_login ?? "NotebookLens reviewer";
  const previewText = summarizeThreadPreview(thread);
  const messageCount = thread.messages.length;
  const sectionId = `${surface === "index" ? "index-" : ""}${buildThreadSectionId(thread.id)}`;

  return (
    <details
      className="thread-card thread-card-flat thread-details"
      id={sectionId}
      open={thread.status !== "resolved"}
    >
      <summary className="thread-summary">
        <div className="thread-summary-main">
          <div className="thread-heading-copy">
            <strong>{authorLabel}</strong>
            <p className="thread-preview">{previewText}</p>
          </div>
          <div className="thread-head-pills">
            <StatusPill label={thread.status} tone={threadTone(thread.status)} />
            {thread.carried_forward ? <StatusPill label="continued here" tone="accent" /> : null}
          </div>
        </div>
        <div className="thread-secondary-row">
          <span className="muted-copy">
            Started {formatTimestamp(thread.created_at)} · {messageCount} message{messageCount === 1 ? "" : "s"}
          </span>
          <span className="muted-copy thread-mirror-note" title={mirrorStatus.description}>
            GitHub: {mirrorStatus.label}
          </span>
        </div>
      </summary>

      {(thread.github_root_comment_url || thread.github_last_mirrored_at) ? (
        <div className="thread-secondary-row thread-secondary-row-expanded">
          <span className="muted-copy thread-mirror-note" title={mirrorStatus.description}>
            GitHub: {mirrorStatus.label}
          </span>
          <div className="thread-secondary-links">
            {thread.github_root_comment_url && mirrorStatus.linkLabel ? (
              <a
                className="text-link"
                href={thread.github_root_comment_url}
                rel="noreferrer"
                target="_blank"
              >
                {mirrorStatus.linkLabel}
              </a>
            ) : null}
            {thread.github_last_mirrored_at ? (
              <span className="muted-copy">
                Last update {formatTimestamp(thread.github_last_mirrored_at)}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="message-stack">
        {thread.messages.map((message) => (
          <div className="message-card" key={message.id}>
            <div className="message-meta">
              <strong>{message.author_login}</strong>
              <div className="message-meta-links">
                <span>{formatTimestamp(message.created_at)}</span>
                {message.github_reply_comment_url ? (
                  <a
                    className="text-link"
                    href={message.github_reply_comment_url}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Mirrored reply
                  </a>
                ) : null}
              </div>
            </div>
            <div className="message-body markdown-body">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.body_markdown}</ReactMarkdown>
            </div>
          </div>
        ))}
      </div>

      <div className="thread-actions">
        <details className="reply-details">
          <summary>Reply</summary>
          <ThreadMutationForm
            action={buildWorkspaceActionPath("reply-thread")}
            className="thread-form thread-form-reply"
            method="post"
          >
            <input name="returnTo" type="hidden" value={`${currentPath.split("#")[0]}#${sectionId}`} />
            <input name="threadId" type="hidden" value={thread.id} />
            <textarea
              aria-label={`Reply to ${authorLabel}`}
              name="bodyMarkdown"
              placeholder="Add context or answer the open question."
              required
              rows={3}
            />
            <div className="thread-form-actions">
              <span className="muted-copy">Reply in place.</span>
              <button className="primary-button" type="submit">
                Add reply
              </button>
            </div>
          </ThreadMutationForm>
        </details>

        {thread.status === "resolved" ? (
          <ThreadMutationForm action={buildWorkspaceActionPath("reopen-thread")} pendingLabel="Reopening…">
            <input name="returnTo" type="hidden" value={`${currentPath.split("#")[0]}#${sectionId}`} />
            <input name="threadId" type="hidden" value={thread.id} />
            <button className="secondary-button" type="submit">
              Reopen
            </button>
          </ThreadMutationForm>
        ) : (
          <ThreadMutationForm action={buildWorkspaceActionPath("resolve-thread")} pendingLabel="Resolving…">
            <input name="returnTo" type="hidden" value={`${currentPath.split("#")[0]}#${sectionId}`} />
            <input name="threadId" type="hidden" value={thread.id} />
            <button className="secondary-button" type="submit">
              Resolve
            </button>
          </ThreadMutationForm>
        )}
      </div>
    </details>
  );
}


function QuickJumpRailCard({
  notebookTargets,
  threadTargets,
  outputTargets,
}: {
  notebookTargets: RailJumpTarget[];
  threadTargets: RailJumpTarget[];
  outputTargets: RailJumpTarget[];
}) {
  const [activeHash, setActiveHash] = useState("");

  useEffect(() => {
    const syncHash = () => {
      setActiveHash(window.location.hash);
    };

    syncHash();
    window.addEventListener("hashchange", syncHash);
    return () => {
      window.removeEventListener("hashchange", syncHash);
    };
  }, []);

  return (
    <section className="side-card side-card-compact">
      <div className="sidebar-rail-head">
        <h2>Review navigation</h2>
      </div>
      <div className="sidebar-jump-list">
        <RailJumpButton
          activeHash={activeHash}
          emptyStateLabel="No notebooks with open threads on this push."
          label="Next notebook with open threads"
          targets={notebookTargets}
          onNavigate={setActiveHash}
        />
        <RailJumpButton
          activeHash={activeHash}
          emptyStateLabel="No unresolved code/output discussions in Changes."
          label="Next unresolved thread"
          targets={threadTargets}
          onNavigate={setActiveHash}
        />
        <RailJumpButton
          activeHash={activeHash}
          emptyStateLabel="No changed outputs are visible in this push."
          label="Next changed output"
          targets={outputTargets}
          onNavigate={setActiveHash}
        />
      </div>
      <div className="sidebar-jump-footer">
        <a className="text-link" href={`#${WORKSPACE_TOP_ID}`}>
          Back to top
        </a>
        <a className="text-link" href={`#${SNAPSHOT_HISTORY_ID}`}>
          Switch push
        </a>
      </div>
    </section>
  );
}


function RailJumpButton({
  activeHash,
  emptyStateLabel,
  label,
  onNavigate,
  targets,
}: {
  activeHash: string;
  emptyStateLabel: string;
  label: string;
  onNavigate: (hash: string) => void;
  targets: RailJumpTarget[];
}) {
  const nextTarget = getNextRailTarget(targets, activeHash);
  const targetCountLabel =
    targets.length === 0 ? "Unavailable" : `${targets.length} ${pluralize(targets.length, "target")}`;

  return (
    <button
      className="sidebar-jump-button"
      disabled={nextTarget === null}
      onClick={() => {
        if (nextTarget === null) {
          return;
        }
        jumpToFragment(nextTarget.id, onNavigate);
      }}
      type="button"
    >
      <span className="sidebar-jump-copy">
        <span className="sidebar-jump-kicker">{label}</span>
        <strong>{nextTarget?.label ?? "Nothing queued here"}</strong>
        <span className="history-caption">
          {nextTarget?.caption ?? emptyStateLabel}
        </span>
      </span>
      <span className="sidebar-jump-meta">{targetCountLabel}</span>
    </button>
  );
}


function SnapshotHistoryRailCard({
  review,
}: {
  review: WorkspacePayload["review"];
}) {
  return (
    <details className="side-card side-card-compact sidebar-disclosure" id={SNAPSHOT_HISTORY_ID}>
      <summary className="sidebar-disclosure-summary">
        <span>
          <strong>Switch push</strong>
          <span className="history-caption notebook-jump-summary-copy">
            {review.snapshot_history.length} saved{" "}
            {pluralize(review.snapshot_history.length, "push")}
          </span>
        </span>
        <span className="muted-copy">Open only if needed</span>
      </summary>
      <div className="history-list">
        {review.snapshot_history
          .slice()
          .reverse()
          .map((entry) => {
            const href = entry.is_latest
              ? buildSnapshotRoute(
                  review.owner,
                  review.repo,
                  review.pull_number,
                  null,
                )
              : buildSnapshotRoute(
                  review.owner,
                  review.repo,
                  review.pull_number,
                  entry.snapshot_index,
                );

            return (
              <Link
                className={`history-link ${
                  review.selected_snapshot_index === entry.snapshot_index
                    ? "history-link-active"
                    : ""
                }`}
                href={href as Route}
                key={entry.id}
              >
                <span>
                  {entry.is_latest
                    ? `Latest push (${entry.snapshot_index})`
                    : `Push ${entry.snapshot_index}`}
                </span>
                <span className="history-caption">{entry.head_sha.slice(0, 12)}</span>
              </Link>
            );
          })}
      </div>
    </details>
  );
}


function summarizeThreadPreview(thread: ReviewThread): string {
  const body = thread.messages[0]?.body_markdown?.replace(/\s+/g, " ").trim();

  if (!body) {
    return "Open the thread for the full discussion.";
  }

  if (body.length <= 110) {
    return body;
  }

  return `${body.slice(0, 107).trimEnd()}...`;
}


function StatusPill({
  label,
  tone,
}: {
  label: string;
  tone: "default" | "accent" | "success" | "warning" | "danger";
}) {
  return <span className={`status-pill tone-${tone}`}>{label}</span>;
}


function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <section className="summary-card empty-state-card">
      <p className="eyebrow">Review status</p>
      <h2>{title}</h2>
      <p className="muted-copy">{description}</p>
    </section>
  );
}


function blockTitle(blockKind: SnapshotBlockKind): string {
  if (blockKind === "source") {
    return "Code";
  }
  if (blockKind === "outputs") {
    return "Outputs";
  }
  return "Metadata";
}


function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}


function threadTone(status: ReviewThread["status"]): "accent" | "success" | "warning" {
  if (status === "resolved") {
    return "success";
  }
  if (status === "outdated") {
    return "warning";
  }
  return "accent";
}


function outputChangeTone(
  changeType: string,
): "success" | "danger" | "default" {
  if (changeType === "added") {
    return "success";
  }
  if (changeType === "removed" || changeType === "deleted") {
    return "danger";
  }
  return "default";
}


function formatReviewStatusLabel(status: WorkspacePayload["review"]["status"]): string {
  if (status === "ready") {
    return "Review ready";
  }
  if (status === "pending") {
    return "Preparing review";
  }
  if (status === "failed") {
    return "Needs attention";
  }
  return "Review closed";
}


function formatSnapshotStatusLabel(status: ReviewSnapshotRecord["status"]): string {
  if (status === "ready") {
    return "Ready to review";
  }
  if (status === "pending") {
    return "Preparing";
  }
  return "Needs attention";
}


function formatChangeTypeLabel(changeType: SnapshotNotebook["change_type"]): string {
  if (changeType === "modified") {
    return "updated";
  }
  if (changeType === "added") {
    return "new";
  }
  if (changeType === "deleted" || changeType === "removed") {
    return "removed";
  }
  return changeType;
}


function formatCellTypeLabel(cellType: RenderRow["cell_type"]): string {
  if (cellType === "code") {
    return "Code cell";
  }
  if (cellType === "markdown") {
    return "Markdown cell";
  }
  return "Raw cell";
}


function formatRowChangeLabel(changeType: RenderRow["change_type"]): string {
  if (changeType === "modified") {
    return "updated";
  }
  if (changeType === "added") {
    return "added";
  }
  if (changeType === "deleted" || changeType === "removed") {
    return "removed";
  }
  if (changeType === "output_changed") {
    return "outputs changed";
  }
  return "moved";
}


function splitNotebookPath(path: string): [string, string] {
  const parts = path.split("/");
  const fileLabel = parts.pop() ?? path;
  const directoryLabel = parts.length ? parts.join(" / ") : "Repository root";
  return [directoryLabel, fileLabel];
}


function countThreadsForNotebook(
  notebook: SnapshotNotebook,
  threadsByAnchor: Map<string, ReviewThread[]>,
): number {
  return getThreadsForNotebook(notebook, threadsByAnchor).length;
}


function collectRailNavigationData(
  notebooks: SnapshotNotebook[],
  threadsByAnchor: Map<string, ReviewThread[]>,
): RailNavigationData {
  const notebookTargets: RailJumpTarget[] = [];
  const threadTargets: RailJumpTarget[] = [];
  const outputTargets: RailJumpTarget[] = [];
  const orderedOpenThreads: ReviewThread[] = [];
  const seenThreadIds = new Set<string>();

  for (const notebook of notebooks) {
    const [directoryLabel, fileLabel] = splitNotebookPath(notebook.path);
    const notebookOpenThreads = getThreadsForNotebook(notebook, threadsByAnchor).filter(
      (thread) => thread.status === "open",
    );

    if (notebookOpenThreads.length > 0) {
      notebookTargets.push({
        id: buildNotebookSectionId(notebook.path),
        label: fileLabel,
        caption: `${directoryLabel} · ${notebookOpenThreads.length} open ${pluralize(
          notebookOpenThreads.length,
          "thread",
        )}`,
      });
    }

    for (const row of notebook.render_rows) {
      if (isBlockChanged(row, "outputs") && hasMeaningfulBlockContent(row, "outputs")) {
        outputTargets.push({
          id: buildBlockSectionId(row.thread_anchors.outputs),
          label: `${fileLabel} · ${formatCellLabel(row)}`,
          caption: row.summary.trim() || `${directoryLabel} · Changed output`,
        });
      }

      for (const blockKind of getReviewBlockKinds(row, threadsByAnchor)) {
        const threads = threadsByAnchor.get(buildAnchorKey(row.thread_anchors[blockKind])) ?? [];

        for (const thread of threads) {
          if (thread.status !== "open" || seenThreadIds.has(thread.id)) {
            continue;
          }

          seenThreadIds.add(thread.id);
          orderedOpenThreads.push(thread);
          threadTargets.push({
            id: buildThreadSectionId(thread.id),
            label: `${fileLabel} · ${formatThreadAnchorSummary(thread.anchor)}`,
            caption: directoryLabel,
          });
        }
      }
    }
  }

  return {
    notebookTargets,
    threadTargets,
    outputTargets,
    orderedOpenThreads,
  };
}


function getThreadsForNotebook(
  notebook: SnapshotNotebook,
  threadsByAnchor: Map<string, ReviewThread[]>,
): ReviewThread[] {
  const seen = new Set<string>();
  const notebookThreads: ReviewThread[] = [];

  for (const row of notebook.render_rows) {
    for (const anchor of Object.values(row.thread_anchors)) {
      const threads = threadsByAnchor.get(buildAnchorKey(anchor)) ?? [];
      for (const thread of threads) {
        if (!seen.has(thread.id)) {
          seen.add(thread.id);
          notebookThreads.push(thread);
        }
      }
    }
  }

  return notebookThreads;
}

function hasVisibleReviewBlocks(row: RenderRow, threads: Map<string, ReviewThread[]>): boolean {
  return getReviewBlockKinds(row, threads).length > 0;
}

function getReviewBlockKinds(row: RenderRow, threads: Map<string, ReviewThread[]>): ("source" | "outputs")[] {
  const blocks = getVisibleBlockKinds(row, threads).filter((kind) => kind !== "metadata");
  if (row.change_type === "moved" && !blocks.includes("source")) blocks.unshift("source");
  return blocks;
}


function buildNotebookSectionId(path: string): string {
  return `notebook-${toFragmentId(path)}`;
}


function buildThreadComposerId(anchor: ThreadAnchor): string {
  return `thread-composer-${toFragmentId(buildAnchorFragment(anchor))}`;
}


function buildBlockSectionId(anchor: ThreadAnchor): string {
  return `block-${toFragmentId(buildAnchorFragment(anchor))}`;
}


function buildThreadSectionId(threadId: string): string {
  return `thread-${toFragmentId(threadId)}`;
}


function buildNotebookReviewSummary({
  firstVisibleRow,
  reviewItemCount,
  noticeCount,
  openThreadCount,
}: {
  firstVisibleRow: RenderRow | null;
  reviewItemCount: number;
  noticeCount: number;
  openThreadCount: number;
}): string | null {
  const sentences: string[] = [];

  if (firstVisibleRow) {
    const firstRowSummary = firstVisibleRow.summary.trim();
    const firstRowLabel = formatCellLabel(firstVisibleRow);
    sentences.push(
      firstRowSummary
        ? `First changed row: ${firstRowLabel}. ${firstRowSummary}`
        : `First changed row: ${firstRowLabel}.`,
    );
    if (reviewItemCount > 1) {
      const remainingCount = reviewItemCount - 1;
      sentences.push(`${remainingCount} more ${pluralize(remainingCount, "changed row")}.`);
    }
  } else if (noticeCount > 0) {
    sentences.push(`Notebook notes only. ${noticeCount} ${pluralize(noticeCount, "note")}.`);
  }

  if (openThreadCount > 0) {
    sentences.push(`${openThreadCount} open ${pluralize(openThreadCount, "thread")}.`);
  }

  if (noticeCount > 0 && firstVisibleRow) {
    sentences.push(`${noticeCount} notebook ${pluralize(noticeCount, "note")}.`);
  }

  if (sentences.length === 0) {
    return "Notebook change ready for review.";
  }

  return sentences.join(" ");
}


function formatThreadAnchorSummary(anchor: ThreadAnchor): string {
  const displayIndex = anchor.cell_locator.display_index;
  const cellLabel = displayIndex === null ? "Notebook-level" : formatCellLabel({ locator: anchor.cell_locator });

  return `${cellLabel} · ${blockTitle(anchor.block_kind)}`;
}


function pluralize(count: number, singular: string): string {
  return count === 1 ? singular : `${singular}s`;
}


function getNextRailTarget(
  targets: RailJumpTarget[],
  activeHash: string,
): RailJumpTarget | null {
  if (targets.length === 0) {
    return null;
  }

  const currentId = activeHash.startsWith("#") ? activeHash.slice(1) : activeHash;
  const currentIndex = targets.findIndex((target) => target.id === currentId);
  if (currentIndex === -1) {
    return targets[0] ?? null;
  }

  return targets[(currentIndex + 1) % targets.length] ?? null;
}


function jumpToFragment(fragmentId: string, onNavigate: (hash: string) => void): void {
  if (typeof window === "undefined") {
    return;
  }

  const nextHash = `#${fragmentId}`;
  revealFragment(fragmentId);
  if (window.location.hash === nextHash) {
    document.getElementById(fragmentId)?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
    onNavigate(nextHash);
    return;
  }

  window.location.hash = fragmentId;
  onNavigate(nextHash);
}


function buildAnchorFragment(anchor: ThreadAnchor): string {
  const locator =
    anchor.cell_locator.display_index ??
    anchor.cell_locator.head_index ??
    anchor.cell_locator.base_index ??
    "notebook";

  return JSON.stringify([
    anchor.notebook_path,
    anchor.block_kind,
    locator,
    anchor.source_fingerprint,
  ]);
}


function toFragmentId(value: string): string {
  return Array.from(value).map((character) => /^[a-zA-Z0-9-]$/.test(character) ? character : `~${character.codePointAt(0)!.toString(16)}~`).join("");
}

function revealFragment(fragmentId: string): void {
  const target = document.getElementById(fragmentId);
  for (let ancestor: HTMLElement | null = target; ancestor; ancestor = ancestor.parentElement) {
    if (ancestor instanceof HTMLDetailsElement) ancestor.open = true;
  }
  target?.scrollIntoView?.({ block: "start" });
}
