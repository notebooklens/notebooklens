import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ReviewWorkspace } from "../components/review-workspace";
import type { RenderRow, ReviewThread, SnapshotNotebook, WorkspacePayload } from "./types";


vi.stubGlobal("React", React);

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => React.createElement("img", props),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
  }) => React.createElement("a", { href, ...props }, children),
}));


function buildRow(overrides: Partial<RenderRow> = {}): RenderRow {
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


function buildRowForNotebook(
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


function buildNotebook(path: string, row: RenderRow): SnapshotNotebook {
  return {
    path,
    change_type: "modified",
    notices: [],
    render_rows: [row],
  };
}


function buildWorkspaceFromNotebooks(
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


function buildWorkspace(row: RenderRow): WorkspacePayload {
  return buildWorkspaceFromNotebooks([
    buildNotebook("analysis/notebook.ipynb", row),
  ]);
}


function buildThread(
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


function renderWorkspacePayload(workspace: WorkspacePayload): string {
  return renderToStaticMarkup(
    React.createElement(ReviewWorkspace, {
      workspace,
      currentPath: "/reviews/octo-org/notebooklens/pulls/7",
      flashNotice: null,
    }),
  );
}


function renderWorkspace(row: RenderRow): string {
  return renderWorkspacePayload(buildWorkspace(row));
}


describe("review workspace rendering", () => {
  it("does not hide failed-snapshot discussions behind unrendered anchors", () => {
    const row = buildRow();
    const workspace = buildWorkspace(row);
    workspace.snapshot!.status = "failed";
    workspace.threads = [buildThread(row)];
    const markup = renderWorkspacePayload(workspace);
    expect(markup).toContain("Discussions needing anchor review (1)");
    expect(markup.match(/id="thread-thread-id"/g)).toHaveLength(1);
  });

  it("keeps distinct notebook paths distinct in navigation IDs", () => {
    const row = buildRow({ source: { base: "old", head: "new", changed: true } });
    const first = buildNotebook("analysis/a_b.ipynb", row);
    const second = buildNotebook("analysis/a-b.ipynb", row);
    const markup = renderWorkspacePayload(buildWorkspaceFromNotebooks([first, second]));
    const notebookIds = Array.from(markup.matchAll(/class="notebook-card notebook-card-flat" id="([^"]+)"/g), (match) => match[1]);
    expect(notebookIds).toHaveLength(2);
    expect(new Set(notebookIds).size).toBe(2);
  });
  it("surfaces drifted discussions once without asserting a current anchor", () => {
    const row = buildRow();
    const workspace = buildWorkspace(row);
    workspace.threads = [buildThread(row, { anchor_drifted: true })];
    const markup = renderWorkspacePayload(workspace);
    expect(markup).toContain("Discussions needing anchor review (1)");
    expect(markup.match(/id="thread-thread-id"/g)).toHaveLength(1);
  });

  it("omits per-cell metadata from the code review", () => {
    const markup = renderWorkspace(buildRow({ change_type: "added", metadata: { changed: true, summary: "material metadata changed" } }));
    expect(markup).not.toContain('class="metadata-disclosure"');
    expect(markup).not.toContain("Metadata included with added cell");
    expect(markup).not.toContain("material metadata changed");
  });
  it("keeps the create-thread composer hidden until a reviewer opens it", () => {
    const markup = renderWorkspace(
      buildRow({
        source: {
          base: "print('accuracy')",
          head: "print('new accuracy')",
          changed: true,
        },
      }),
    );

    expect(markup).toContain("Add comment");
    expect(markup).not.toContain("Start a thread");
    expect(markup).not.toContain("Create thread");
    expect(markup).not.toContain("Keep it attached to this block.");
  });

  it("suppresses empty output and metadata rows instead of rendering a shell card", () => {
    const markup = renderWorkspace(
      buildRow({
        outputs: {
          changed: true,
          items: [],
        },
        metadata: {
          changed: true,
          summary: "   ",
        },
      }),
    );

    expect(markup).not.toContain("Output summary diff");
    expect(markup).not.toContain("Metadata diff");
    expect(markup).not.toContain("Metric output changed.");
    expect(markup).toContain("No code or output changes on this push");
  });

  it("skips empty output cards inside an otherwise meaningful output block", () => {
    const markup = renderWorkspace(
      buildRow({
        outputs: {
          changed: true,
          items: [
            {
              kind: "placeholder",
              output_type: "execute_result",
              mime_group: "text",
              summary: "   ",
              truncated: false,
              change_type: "modified",
            },
            {
              kind: "placeholder",
              output_type: "stream",
              mime_group: "text",
              summary: "Accuracy dropped from 0.92 to 0.88.",
              truncated: false,
              change_type: "modified",
            },
          ],
        },
      }),
    );

    expect(markup).toContain("Outputs");
    expect(markup).toContain("Accuracy dropped from 0.92 to 0.88.");
    expect(markup).not.toContain("execute_result");
  });

  it("uses disclosures for snapshot details and multi-notebook navigation", () => {
    const firstNotebook = buildNotebook(
      "analysis/notebook.ipynb",
      buildRowForNotebook("analysis/notebook.ipynb", {
        source: {
          base: "print('accuracy')",
          head: "print('new accuracy')",
          changed: true,
        },
      }),
    );
    const secondNotebook = buildNotebook(
      "analysis/second-notebook.ipynb",
      buildRowForNotebook("analysis/second-notebook.ipynb", {
        locator: {
          cell_id: "second-cell",
          base_index: 2,
          head_index: 2,
          display_index: 2,
        },
        summary: "Validation chart changed.",
        source: {
          base: "display(validation_chart_old)",
          head: "display(validation_chart_new)",
          changed: true,
        },
      }),
    );

    const markup = renderWorkspacePayload(
      buildWorkspaceFromNotebooks(
        [firstNotebook, secondNotebook],
        "Two notebooks changed in this review version.",
      ),
    );

    expect(markup).toContain("Push details");
    expect(markup).toContain('aria-label="Workspace navigation"');
    expect(markup).toMatch(/href="\/"[^>]*>Home<\/a>/);
    expect(markup).toContain('class="review-version-controls"');
    expect(markup).not.toContain('class="workspace-sidebar"');
    expect(markup).not.toContain('workspace-utility-card');
    expect(markup).toContain('aria-label="Notebook"');
    expect(markup).toContain("Notebooks (2)");
    expect(markup).toContain("Two notebooks changed in this review version.");
  });

  it("labels Markdown review controls truthfully and omits empty discussion spacing", () => {
    const row = buildRow({ cell_type: "markdown", change_type: "added", source: { base: null, head: "# Findings", changed: true }, outputs: { changed: false, items: [] } });
    const markup = renderWorkspace(row);
    expect(markup).toContain("Add comment on Cell 2 markdown");
    expect(markup).toContain('<h4 class="sr-only">Markdown</h4>');
    expect(markup).not.toContain('<h4 class="sr-only">Code</h4>');
    expect(markup).not.toContain('class="thread-column"');
    expect(markup).toContain('<span class="sr-only">Added cell</span>');
    expect(markup).toContain("markdown-pane-added");
  });

  it("keeps push history to a full subject and one metadata block without changing links", () => {
    const workspace = buildWorkspace(buildRow());
    const subject = "Compare weekly observations without truncating the descriptive commit subject";
    workspace.review.snapshot_history[0].head_commit_subject = subject;
    const markup = renderWorkspacePayload(workspace);
    expect(markup).toContain(`<strong>${subject}</strong>`);
    expect(markup.match(/class="history-caption history-entry-meta"/g)).toHaveLength(1);
    expect(markup).toContain('dateTime="2026-04-12T12:00:00Z"');
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain(" · Latest");
    expect(markup).toContain(" · Current");
  });

  it("keeps the default rail focused and moves review signals into collapsible summaries", () => {
    const row = buildRow({
      outputs: {
        changed: true,
        items: [
          {
            kind: "placeholder",
            output_type: "stream",
            mime_group: "text",
            summary: "Accuracy dropped from 0.92 to 0.88.",
            truncated: false,
            change_type: "modified",
          },
        ],
      },
    });
    const notebook = buildNotebook("analysis/notebook.ipynb", row);
    notebook.notices = ["Re-run this notebook after refreshing the staged fixture data."];
    const workspace = buildWorkspaceFromNotebooks([notebook]);
    workspace.snapshot!.payload.review.notices = ["Check the staged benchmark inputs before merging."];
    workspace.snapshot!.flagged_findings = [
      {
        severity: "high",
        summary: "Validation accuracy regressed in the benchmark output.",
      },
    ];
    workspace.snapshot!.reviewer_guidance = [
      {
        label: "Regression triage",
        prompt: "Confirm whether the metric drop is expected for this push.",
      },
    ];
    workspace.threads = [buildThread(row)];

    const markup = renderWorkspacePayload(workspace);

    expect(markup).not.toContain("Review navigation");
    expect(markup).not.toContain("Next notebook with open threads");
    expect(markup).not.toContain("Next unresolved thread");
    expect(markup).not.toContain("Next changed output");
    expect(markup).not.toContain("Back to top");
    expect(markup).toContain("Switch push");
    expect(markup).not.toContain("Open thread");
    expect(markup).not.toContain("Switch PR version");
    expect(markup).not.toContain("PR Versions");
    expect(markup).not.toContain("Where to look first");
    expect(markup).not.toContain("Review signals");
    expect(markup).not.toContain("Workspace access");
    expect(markup).not.toContain("What needs attention");
    expect(markup).toContain("Check the staged benchmark inputs before merging.");
    expect(markup).not.toContain("Validation accuracy regressed in the benchmark output.");
    expect(markup).not.toContain("Confirm whether the metric drop is expected for this push.");
    expect(markup).toContain("First changed row: Cell 2. Metric output changed.");
    expect(markup).toContain("1 open thread.");
    expect(markup).toContain("1 notebook note.");
    expect(markup).toContain("Notebook notes");
    expect(markup).toContain("Re-run this notebook after refreshing the staged fixture data.");
    expect(markup).not.toContain("Review items");
    expect(markup).not.toContain("Inline threads");
    expect(markup).not.toContain("PR version");
    expect(markup).not.toContain("Review notes");
    expect(markup).not.toContain("installation-scoped");
    expect(markup).toContain("Account &amp; settings");
    expect(markup).toContain("Open team AI settings");
  });

  it("renders unresolved threads open with compact GitHub metadata", () => {
    const row = buildRow({
      outputs: {
        changed: true,
        items: [
          {
            kind: "placeholder",
            output_type: "stream",
            mime_group: "text",
            summary: "Accuracy dropped from 0.92 to 0.88.",
            truncated: false,
            change_type: "modified",
          },
        ],
      },
    });
    const workspace = buildWorkspace(row);
    workspace.threads = [
      buildThread(row, {
        github_mirror_state: "mirrored",
        github_root_comment_url: "https://github.example/thread/1",
        github_last_mirrored_at: "2026-04-12T13:30:00Z",
      }),
    ];

    const markup = renderWorkspacePayload(workspace);

    expect(markup).toContain("Add comment");
    expect(markup).not.toContain('class="thread-column-head"');
    expect(markup).toContain("Please explain why the validation accuracy regressed on this output.");
    expect(markup).toContain("GitHub: Posted");
    expect(markup).toContain("Open mirrored PR thread");
    expect(markup).toContain("View in notebook");
    expect(markup).toContain('id="thread-thread-id"');
    expect(markup).toContain('class="thread-card thread-card-flat thread-details"');
    expect(markup).toMatch(/id="thread-thread-id" open=""/);
  });

  it("renders bounded text output with a side badge and pretty-printed JSON", () => {
    const markup = renderWorkspace(
      buildRow({
        outputs: {
          changed: true,
          items: [
            {
              kind: "text",
              text: '{"accuracy":0.92}',
              mime_type: "application/json",
              summary: "JSON output updated",
              truncated: false,
              change_type: "modified",
              side: "head",
            },
          ],
        },
      }),
    );

    expect(markup).toContain("JSON output");
    expect(markup).toContain("&quot;accuracy&quot;: 0.92");
    expect(markup).toContain(">Head<");
  });

  it("marks truncated text output explicitly instead of showing broken partial data", () => {
    const markup = renderWorkspace(
      buildRow({
        outputs: {
          changed: true,
          items: [
            {
              kind: "text",
              text: "partial stdout up to the bound",
              mime_type: "stream",
              summary: "stream output updated",
              truncated: true,
              change_type: "modified",
            },
          ],
        },
      }),
    );

    expect(markup).toContain("Output text truncated");
  });

  it("renders HTML output inside a script-disabled sandboxed iframe with scripts stripped", () => {
    const markup = renderWorkspace(
      buildRow({
        outputs: {
          changed: true,
          items: [
            {
              kind: "html",
              html: '<table><tr><td>1</td></tr></table><script>alert(1)</script>',
              summary: "HTML table updated",
              truncated: false,
              change_type: "modified",
              side: "base",
            },
          ],
        },
      }),
    );

    expect(markup).toContain('sandbox=""');
    expect(markup).toContain("&lt;table&gt;&lt;tr&gt;&lt;td&gt;1&lt;/td&gt;&lt;/tr&gt;&lt;/table&gt;");
    expect(markup).not.toContain("<script>alert(1)</script>");
    expect(markup).toContain("default-src &#x27;none&#x27;");
    expect(markup).toContain(">Base<");
  });

  it("embeds Plotly figures in an opaque-origin sandbox iframe without allow-same-origin", () => {
    const markup = renderWorkspace(
      buildRow({
        outputs: {
          changed: true,
          items: [
            {
              kind: "plotly",
              spec: { data: [{ type: "bar", y: [1, 2, 3] }] },
              summary: "Plotly figure updated",
              truncated: false,
              change_type: "modified",
            },
          ],
        },
      }),
    );

    expect(markup).toContain("Plotly figure");
    expect(markup).toContain('sandbox="allow-scripts"');
    expect(markup).not.toContain("allow-same-origin");
    expect(markup).toContain('src="/interactive-renderer/index.html"');
  });

  it("embeds saved widgets in the same sandboxed renderer and shows an explicit notice for malformed state", () => {
    const markup = renderWorkspace(
      buildRow({
        outputs: {
          changed: true,
          items: [
            {
              kind: "widget",
              view: { model_id: "missing-model" },
              state: { version_major: 2, version_minor: 0, state: {} },
              summary: "Saved widget updated",
              truncated: false,
              change_type: "modified",
            },
          ],
        },
      }),
    );

    expect(markup).toContain("Saved widget");
    expect(markup).toContain("Rejected:");
  });

  it("renders markdown cell source through the Markdown renderer instead of raw code panes", () => {
    const markup = renderWorkspace(
      buildRow({
        cell_type: "markdown",
        source: {
          base: "# Title\n\nSee [docs](https://example.com).",
          head: "# New title\n\nSee [docs](https://example.com).",
          changed: true,
        },
      }),
    );

    expect(markup).toContain("<h1>Title</h1>");
    expect(markup).toContain("<h1>New title</h1>");
    expect(markup).toContain('<a href="https://example.com">docs</a>');
  });

  it("renders code cell source as line-numbered diff panes", () => {
    const markup = renderWorkspace(
      buildRow({
        source: {
          base: "print('accuracy')\nprint('done')",
          head: "print('new accuracy')\nprint('done')",
          changed: true,
        },
      }),
    );

    expect(markup).toContain("code-diff-line-removed");
    expect(markup).toContain("code-diff-line-added");
    expect(markup).toContain("code-diff-line-unchanged");
  });

  it.each(["added", "deleted", "removed"])("marks all source lines and cell badges for a whole %s cell", (changeType) => {
    const added = changeType === "added";
    const markup = renderWorkspace(buildRow({
      change_type: changeType,
      source: { base: added ? null : "old_value = 1\nprint(old_value)", head: added ? "new_value = 2\nprint(new_value)" : null, changed: true },
    }));
    expect(markup.match(new RegExp(`code-diff-line-${added ? "added" : "removed"}`, "g"))).toHaveLength(2);
    expect(markup).not.toContain("code-diff-line-unchanged");
    expect(markup).toContain(`tone-${added ? "success" : "danger"}`);
    expect(markup).toContain(`aria-label="${added ? "Added" : "Removed"}"`);
  });

  it.each(["added", "deleted"])("renders whole %s Markdown with a matching tint class and explicit label", (changeType) => {
    const added = changeType === "added";
    const markup = renderWorkspace(buildRow({
      change_type: changeType, cell_type: "markdown",
      source: { base: added ? null : "# Old report", head: added ? "# New report" : null, changed: true },
    }));
    expect(markup).toContain(`markdown-pane-${added ? "added" : "removed"}`);
    expect(markup).toContain(added ? "Added cell" : "Removed cell");
    expect(markup).toContain(added ? "<h1>New report</h1>" : "<h1>Old report</h1>");
  });

  it("renders thread reply markdown instead of raw asterisks", () => {
    const row = buildRow({
      outputs: {
        changed: true,
        items: [
          {
            kind: "placeholder",
            output_type: "stream",
            mime_group: "text",
            summary: "Accuracy dropped from 0.92 to 0.88.",
            truncated: false,
            change_type: "modified",
          },
        ],
      },
    });
    const workspace = buildWorkspace(row);
    workspace.threads = [
      buildThread(row, {
        messages: [
          {
            id: "message-1",
            author_github_user_id: 101,
            author_login: "octo-reviewer",
            body_markdown: "Please check the **validation accuracy** regression.",
            created_at: "2026-04-12T12:00:00Z",
            github_reply_comment_id: null,
            github_reply_comment_url: null,
          },
        ],
      }),
    ];

    const markup = renderWorkspacePayload(workspace);

    expect(markup).toContain("<strong>validation accuracy</strong>");
  });
});
