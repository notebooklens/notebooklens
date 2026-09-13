import { buildLoginHref } from "@/lib/public-hrefs";

const WORKSPACE_QUICKSTART_URL =
  "https://notebooklens.github.io/notebooklens/quickstart-workspace/";
const EXAMPLES_URL = "https://notebooklens.github.io/notebooklens/examples/";
const REPOSITORY_URL = "https://github.com/notebooklens/notebooklens";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function readSearchParam(
  searchParams: Record<string, string | string[] | undefined>,
  key: string,
) {
  const value = searchParams[key];
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.find((item) => item.length > 0) ?? null;
  }
  return null;
}

export default async function HomePage({ searchParams }: PageProps) {
  const resolvedSearchParams = await searchParams;
  const installationId = readSearchParam(
    resolvedSearchParams,
    "installation_id",
  );
  const setupAction = readSearchParam(resolvedSearchParams, "setup_action");
  const isReturningFromInstall =
    installationId !== null && setupAction === "install";
  const primaryHref = isReturningFromInstall
    ? WORKSPACE_QUICKSTART_URL
    : buildLoginHref("/");
  const primaryLabel = isReturningFromInstall
    ? "Open workspace quick start"
    : "Continue with GitHub";
  const primaryTitle =
    "Open changed cells, outputs, and inline comments";
  const primaryCopy = isReturningFromInstall
    ? "Use the workspace quick start to open a notebook pull request review with changed cells, rendered outputs, and inline comments already in view."
    : "Continue with GitHub to open notebook pull request reviews with changed cells, rendered outputs, and inline comments already in view.";

  return (
    <main className="center-stage home-stage">
      <section className="hero-card landing-hero landing-hero-priority">
        <div className="hero-copy landing-hero-copy">
          <p className="eyebrow">NotebookLens Review Workspace</p>
          <h1>
            Review notebook pull requests at changed cells, outputs, and
            inline comments.
          </h1>
          <p className="hero-summary">
            Open changed cells, outputs, and inline comments for the notebook
            pull request you need to review.
          </p>
        </div>

        <div className="landing-hero-panel">
          <p className="eyebrow">Next step</p>
          <h2>{primaryTitle}</h2>
          <p className="muted-copy">{primaryCopy}</p>
          <div className="hero-actions landing-actions landing-hero-actions">
            <a
              className="primary-button"
              href={primaryHref}
              rel={isReturningFromInstall ? "noreferrer" : undefined}
              target={isReturningFromInstall ? "_blank" : undefined}
            >
              {primaryLabel}
            </a>
          </div>
          <p className="hero-subsummary landing-hero-note">
            {isReturningFromInstall ? (
              <>
                Need a second proof point before you run it? Check the{" "}
                <a
                  className="landing-inline-link"
                  href={EXAMPLES_URL}
                  rel="noreferrer"
                  target="_blank"
                >
                  current examples
                </a>{" "}
                and{" "}
                <a
                  className="landing-inline-link"
                  href={REPOSITORY_URL}
                  rel="noreferrer"
                  target="_blank"
                >
                  repository docs
                </a>
                .
              </>
            ) : (
              <>
                The one-time repository setup lives in the{" "}
                <a
                  className="landing-inline-link"
                  href={WORKSPACE_QUICKSTART_URL}
                  rel="noreferrer"
                  target="_blank"
                >
                  workspace quick start
                </a>
                .
              </>
            )}
          </p>
        </div>
      </section>

      <section className="landing-proof-layout">
        <article className="summary-card landing-proof-card">
          <div className="summary-head">
            <div>
              <p className="eyebrow">After sign-in</p>
              <h2>What reviewers actually open</h2>
              <p className="summary-text">
                An illustrated snapshot of the current GitHub check run plus
                the notebook-aware workspace it opens on the latest push.
              </p>
            </div>
          </div>

          <div className="landing-proof-stack">
            <figure
              aria-labelledby="landing-proof-preview-caption"
              className="landing-proof-figure"
            >
              <figcaption
                className="landing-proof-banner"
                id="landing-proof-preview-caption"
              >
                <span className="landing-proof-banner-label">
                  Illustration only
                </span>
                <span className="landing-proof-banner-copy">
                  Static preview of the latest notebook review workspace with
                  changed cells, outputs, and inline comments in view.
                </span>
              </figcaption>

              <div className="landing-checkrun-card">
                <div className="landing-checkrun-head">
                  <strong>NotebookLens Review Workspace</strong>
                </div>
                <p className="landing-checkrun-copy landing-checkrun-status">
                  Status: latest push ready with changed cells, outputs, and 1
                  open inline comment in view.
                </p>
              </div>

              <div className="landing-proof-surface">
                <div className="landing-proof-strip">
                  <div className="landing-proof-review-target">
                    <p className="eyebrow">Review target</p>
                    <h3 className="landing-proof-title">
                      acme/forecasting · PR #128
                    </h3>
                    <p className="landing-proof-target-copy">
                      sales_forecast.ipynb · changed output plot + markdown
                      diff
                    </p>
                  </div>
                  <div className="landing-proof-next-action">
                    <span className="summary-label">Next action</span>
                    <strong>Open latest push review</strong>
                    <p>Jump straight to the changed output thread.</p>
                  </div>
                </div>

                <ul className="landing-list landing-proof-list">
                  <li>Changed notebook output stays visible inside the review.</li>
                  <li>Latest push context stays attached before replying on the PR.</li>
                  <li>Inline comments stay anchored to the exact changed block.</li>
                </ul>

                <div className="landing-proof-anchor-demo">
                  <div className="landing-proof-output-card">
                    <div className="landing-proof-output-head">
                      <div>
                        <span className="summary-label">Changed output</span>
                        <strong>Cell 14 · forecast confidence band</strong>
                      </div>
                      <span className="landing-proof-anchor-tag">
                        thread anchored here
                      </span>
                    </div>
                    <div className="landing-proof-output-block">
                      <div
                        aria-hidden="true"
                        className="landing-proof-output-visual"
                      >
                        <span className="landing-proof-output-axis" />
                        <span className="landing-proof-output-band landing-proof-output-band-baseline" />
                        <span className="landing-proof-output-band landing-proof-output-band-current" />
                        <span className="landing-proof-output-line landing-proof-output-line-baseline" />
                        <span className="landing-proof-output-line landing-proof-output-line-current" />
                        <span className="landing-proof-output-anchor-marker">
                          anchor
                        </span>
                      </div>
                      <p className="landing-proof-output-copy">
                        The latest push widens the rendered confidence band, so
                        the review opens on the exact output block under
                        discussion.
                      </p>
                    </div>
                  </div>

                  <div aria-hidden="true" className="landing-proof-anchor-rail">
                    <span className="landing-proof-anchor-dot" />
                  </div>

                  <div className="landing-proof-thread">
                    <span className="summary-label">Open thread</span>
                    <strong>
                      Explain whether the widened confidence band is expected.
                    </strong>
                    <p className="landing-proof-thread-copy">
                      Attached directly to this changed output before replying
                      on the pull request.
                    </p>
                  </div>
                </div>
              </div>
            </figure>
          </div>
        </article>

        <article className="summary-card landing-support-card">
          <p className="eyebrow">One setup reference</p>
          <h2>Keep setup details in one place</h2>
          <p className="muted-copy">
            When a repository still needs the GitHub App, the first notebook
            pull request, or the review workspace check run, the workspace
            quick start covers that one-time checklist end to end.
          </p>
          <p className="hero-subsummary landing-support-copy">
            Use the{" "}
            <a
              className="landing-inline-link"
              href={WORKSPACE_QUICKSTART_URL}
              rel="noreferrer"
              target="_blank"
            >
              workspace quick start
            </a>{" "}
            for setup details. Need the full flow or a second proof point?
            Check the{" "}
            <a
              className="landing-inline-link"
              href={EXAMPLES_URL}
              rel="noreferrer"
              target="_blank"
            >
              current examples
            </a>{" "}
            and{" "}
            <a
              className="landing-inline-link"
              href={REPOSITORY_URL}
              rel="noreferrer"
              target="_blank"
            >
              repository docs
            </a>
            .
          </p>
        </article>
      </section>
    </main>
  );
}
