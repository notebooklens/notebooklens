import type { RenderRow, ReviewThread, SnapshotNotebook, WorkspacePayload } from "../lib/types";
export function buildRow(overrides: Partial<RenderRow> = {}): RenderRow {
  return {
    locator: {
      cell_id: "metric-cell",
      base_index: 1,
      head_index: 1,
      display_index: 1,
    },
    cell_type: "code",
    change_type: "modified",
    summary: "Metric output changed.",
    source: {
      base: "print('accuracy')",
      head: "print('accuracy')",
      changed: false,
    },
    outputs: {
      changed: true,
      items: [],
    },
    metadata: {
      changed: false,
      summary: null,
    },
    review_context: [],
    thread_anchors: {
      source: {
        notebook_path: "analysis/notebook.ipynb",
        cell_locator: {
          cell_id: "metric-cell",
          base_index: 1,
          head_index: 1,
          display_index: 1,
        },
        block_kind: "source",
        source_fingerprint: "source-fingerprint",
        cell_type: "code",
      },
      outputs: {
        notebook_path: "analysis/notebook.ipynb",
        cell_locator: {
          cell_id: "metric-cell",
          base_index: 1,
          head_index: 1,
          display_index: 1,
        },
        block_kind: "outputs",
        source_fingerprint: "output-fingerprint",
        cell_type: "code",
      },
      metadata: {
        notebook_path: "analysis/notebook.ipynb",
        cell_locator: {
          cell_id: "metric-cell",
          base_index: 1,
          head_index: 1,
          display_index: 1,
        },
        block_kind: "metadata",
        source_fingerprint: "metadata-fingerprint",
        cell_type: "code",
      },
    },
    ...overrides,
  };
}


export function buildRowForNotebook(
  notebookPath: string,
  overrides: Partial<RenderRow> = {},
): RenderRow {
  return buildRow({
    thread_anchors: {
      source: {
        notebook_path: notebookPath,
        cell_locator: {
          cell_id: "metric-cell",
          base_index: 1,
          head_index: 1,
          display_index: 1,
        },
        block_kind: "source",
        source_fingerprint: "source-fingerprint",
        cell_type: "code",
      },
      outputs: {
        notebook_path: notebookPath,
        cell_locator: {
          cell_id: "metric-cell",
          base_index: 1,
          head_index: 1,
          display_index: 1,
        },
        block_kind: "outputs",
        source_fingerprint: "output-fingerprint",
        cell_type: "code",
      },
      metadata: {
        notebook_path: notebookPath,
        cell_locator: {
          cell_id: "metric-cell",
          base_index: 1,
          head_index: 1,
          display_index: 1,
        },
        block_kind: "metadata",
        source_fingerprint: "metadata-fingerprint",
        cell_type: "code",
      },
    },
    ...overrides,
  });
}


export function buildNotebook(path: string, row: RenderRow): SnapshotNotebook {
  return {
    path,
    change_type: "modified",
    notices: [],
    render_rows: [row],
  };
}


export function buildWorkspaceFromNotebooks(
  notebooks: SnapshotNotebook[],
  summaryText: string | null = null,
): WorkspacePayload {
  const changedCellCount = notebooks.reduce(
    (total, notebook) => total + notebook.render_rows.length,
    0,
  );

  return {
    review: {
      id: "review-id",
      owner: "octo-org",
      repo: "notebooklens",
      pull_number: 7,
      base_branch: "main",
      status: "ready",
      installation: {
        id: "installation-id",
        account_login: "octo-org",
        account_type: "organization",
      },
      latest_snapshot_id: "snapshot-2",
      latest_snapshot_index: 2,
      selected_snapshot_index: 2,
      thread_counts: {
        unresolved: 1,
        resolved: 0,
        outdated: 0,
      },
      snapshot_history: [
        {
          id: "snapshot-2",
          snapshot_index: 2,
          status: "ready",
          base_sha: "base-sha",
          head_sha: "head-sha",
          created_at: "2026-04-12T12:00:00Z",
          is_latest: true,
        },
      ],
    },
    snapshot: {
      id: "snapshot-2",
      snapshot_index: 2,
      status: "ready",
      base_sha: "base-sha",
      head_sha: "head-sha",
      schema_version: 1,
      summary_text: summaryText,
      flagged_findings: [],
      reviewer_guidance: [],
      payload: {
        schema_version: 1,
        review: {
          notices: [],
          notebooks,
        },
      },
      notebook_count: notebooks.length,
      changed_cell_count: changedCellCount,
      failure_reason: null,
      created_at: "2026-04-12T12:00:00Z",
    },
    threads: [],
  };
}


export function buildWorkspace(row: RenderRow): WorkspacePayload {
  return buildWorkspaceFromNotebooks([
    buildNotebook("analysis/notebook.ipynb", row),
  ]);
}


export function buildThread(
  row: RenderRow,
  overrides: Partial<ReviewThread> = {},
): ReviewThread {
  return {
    id: "thread-id",
    managed_review_id: "review-id",
    origin_snapshot_id: "snapshot-1",
    current_snapshot_id: "snapshot-2",
    anchor: row.thread_anchors.outputs,
    status: "open",
    carried_forward: true,
    created_by_github_user_id: 101,
    created_at: "2026-04-12T12:00:00Z",
    updated_at: "2026-04-12T12:00:00Z",
    resolved_at: null,
    resolved_by_github_user_id: null,
    github_mirror_state: "pending",
    github_root_comment_url: null,
    github_last_mirrored_at: null,
    messages: [
      {
        id: "message-1",
        author_github_user_id: 101,
        author_login: "octo-reviewer",
        body_markdown: "Please explain why the validation accuracy regressed on this output.",
        created_at: "2026-04-12T12:00:00Z",
        github_reply_comment_id: null,
        github_reply_comment_url: null,
      },
    ],
    ...overrides,
  };
}
