import Link from "next/link";
import { notFound } from "next/navigation";

import { ApiRequestError, buildLoginHref, getReviewWorkspace, getSnapshotWorkspace } from "@/lib/api";
import { readFlashNotice } from "@/lib/review-workspace";
import { ReviewWorkspace } from "@/components/review-workspace";


type ReviewRouteProps = {
  owner: string;
  repo: string;
  pullNumber: number;
  snapshotIndex?: number;
  currentPath: string;
  searchParams: Record<string, string | string[] | undefined>;
};


export async function ReviewRoute(props: ReviewRouteProps) {
  const { currentPath, owner, pullNumber, repo, searchParams, snapshotIndex } = props;

  try {
    const workspace =
      snapshotIndex === undefined
        ? await getReviewWorkspace(owner, repo, pullNumber)
        : await getSnapshotWorkspace(owner, repo, pullNumber, snapshotIndex);

    return (
      <ReviewWorkspace
        currentPath={currentPath}
        flashNotice={readFlashNotice(searchParams)}
        workspace={workspace}
      />
    );
  } catch (error) {
    if (error instanceof ApiRequestError) {
      if (error.status === 401) {
        return (
          <AuthWall
            currentPath={currentPath}
            owner={owner}
            pullNumber={pullNumber}
            repo={repo}
            snapshotIndex={snapshotIndex}
          />
        );
      }

      if (error.status === 404) {
        notFound();
      }

      return <ErrorWall detail={error.detail} />;
    }

    throw error;
  }
}


type AuthWallProps = {
  currentPath: string;
  owner: string;
  repo: string;
  pullNumber: number;
  snapshotIndex?: number;
};


function AuthWall({
  currentPath,
  owner,
  pullNumber,
  repo,
  snapshotIndex,
}: AuthWallProps) {
  const reviewIdentity = `${owner}/${repo} · PR #${pullNumber}`;
  const reviewContext =
    snapshotIndex === undefined
      ? reviewIdentity
      : `${reviewIdentity} · Push ${snapshotIndex}`;
  const destinationLabel =
    snapshotIndex === undefined
      ? "Latest review workspace"
      : `Push ${snapshotIndex} snapshot`;

  return (
    <main className="review-entry-stage">
      <div className="workspace-shell review-entry-shell">
        <header className="summary-card workspace-pr-strip">
          <div className="workspace-pr-strip-main">
            <p className="workspace-breadcrumb">NotebookLens review workspace</p>
            <div className="workspace-pr-strip-head">
              <h1 className="workspace-title workspace-title-compact">
                {owner}/{repo}
              </h1>
              <span className="workspace-pr-number">PR #{pullNumber}</span>
            </div>
          </div>
          <div className="workspace-pr-strip-meta">
            <div className="hero-meta workspace-meta">
              <span className="status-pill tone-accent">Sign-in required</span>
              <span className="status-pill tone-default">{destinationLabel}</span>
              <span className="status-pill tone-default">Direct review link</span>
            </div>
            <p className="workspace-strip-caption workspace-strip-caption-inline">
              This link returns to the same PR review with changed cells,
              outputs, and inline comments in focus.
            </p>
          </div>
        </header>

        <div className="workspace-grid">
          <section className="workspace-main">
            <section className="summary-card review-entry-banner">
              <div className="review-entry-banner-copy">
                <p className="eyebrow">Open the review</p>
                <h2 className="review-entry-title">
                  Open changed cells, outputs, and inline comments for this PR.
                </h2>
                <p className="hero-summary review-entry-summary">
                  This direct link already targets {reviewContext}. Continue
                  with GitHub and NotebookLens brings you back to the notebook
                  review surface with the changed cells, outputs, and inline
                  comments already in context.
                </p>
              </div>
              <div className="review-entry-actions">
                <a className="primary-button" href={buildLoginHref(currentPath)}>
                  Continue to {reviewContext}
                </a>
                <Link className="secondary-button" href="/">
                  Back to home
                </Link>
              </div>
            </section>

            <section className="notebook-card review-entry-preview">
              <div className="notebook-head review-entry-preview-head">
                <div>
                  <p className="eyebrow">Review surface</p>
                  <h2>Changed cells, outputs, and inline comments stay front and center</h2>
                  <p className="hero-summary review-entry-summary">
                    PR context stays visible here so the next step opens the
                    review itself, with notebook changes and comments already
                    connected to this pull request.
                  </p>
                </div>
                <div className="hero-meta">
                  <span className="status-pill tone-accent">Changed cells</span>
                  <span className="status-pill tone-default">Outputs</span>
                  <span className="status-pill tone-default">Inline comments</span>
                </div>
              </div>

              <div className="review-entry-preview-grid">
                <article className="review-entry-preview-panel">
                  <p className="summary-label">Changed cells</p>
                  <h3>Notebook diffs are the dominant destination.</h3>
                  <p className="muted-copy">
                    The handoff ends with cell-level changes in view instead of a
                    setup checklist.
                  </p>
                </article>
                <article className="review-entry-preview-panel">
                  <p className="summary-label">Rendered outputs</p>
                  <h3>Output changes remain nearby.</h3>
                  <p className="muted-copy">
                    Reviewers can keep execution results and visual output context in
                    the same flow.
                  </p>
                </article>
                <article className="review-entry-preview-panel">
                  <p className="summary-label">Inline comments</p>
                  <h3>Comments stay attached to the notebook.</h3>
                  <p className="muted-copy">
                    Inline comments return as anchored review items instead of
                    a separate destination to rediscover.
                  </p>
                </article>
              </div>
            </section>
          </section>

          <aside className="workspace-sidebar">
            <section className="side-card review-entry-sidecard">
              <p className="eyebrow">Direct review link</p>
              <h2>{reviewContext}</h2>
              <p className="muted-copy">
                GitHub verification returns you to this same PR review with
                changed cells, outputs, and inline comments still in focus.
              </p>
              <div className="review-entry-sidegrid">
                <div className="summary-metric review-entry-metric">
                  <span className="summary-label">Return target</span>
                  <strong>{destinationLabel}</strong>
                </div>
                <div className="summary-metric review-entry-metric">
                  <span className="summary-label">Review focus</span>
                  <strong>Cells, outputs, and inline comments</strong>
                </div>
              </div>
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}


function ErrorWall({ detail }: { detail: string }) {
  return (
    <main className="center-stage">
      <section className="hero-card compact-card wall-card">
        <p className="eyebrow">Review unavailable</p>
        <h1>NotebookLens could not open this pull request review</h1>
        <p className="hero-summary">{detail}</p>
        <ul className="wall-list">
          <li>Confirm the GitHub check run finished for the latest push.</li>
          <li>Make sure your GitHub session still has access to the repository.</li>
          <li>Retry from the pull request after refreshing your NotebookLens sign-in.</li>
        </ul>
        <p className="muted-copy">
          Reopening the `NotebookLens Review Workspace` check run from GitHub is usually
          the fastest way back to the right page.
        </p>
        <div className="wall-actions">
          <Link className="secondary-button" href="/">
            Return home
          </Link>
        </div>
      </section>
    </main>
  );
}
