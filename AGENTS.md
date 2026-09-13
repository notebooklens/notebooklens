# Developing NotebookLens

## Product boundaries and current status

NotebookLens has two cooperating products; preserve their separate onboarding
and GitHub surfaces:

- The OSS GitHub Action posts an updating PR summary comment. Optional AI is
  separate from notebook-aware deterministic review; `ai-provider: none` works.
- The managed GitHub App, API, worker, and web workspace provide notebook review
  linked from a dedicated check run. Do not accidentally change public Action
  inputs when implementing managed-only features.

The long-term goal is a self-hosted ReviewNB replacement. **Full parity is not
proven.** Do not describe scaffolding, passing unit tests, or local health as
completed live acceptance or permission to retire a license.

Read [replacement scope](docs/replacement-plan.md),
[notebook review UX](docs/review-ux-plan.md),
[local acceptance](docs/local-acceptance.md), and
[dependency security](docs/security-dependencies.md) before related changes.
These contain historical milestones as well as gaps: verify current code and
deployment evidence instead of treating an early plan paragraph as current
status. Update progress/acceptance docs when verified status changes. Keep this
file focused on durable development instructions, not session logs or counts.

## Source map

- `src/github_action.py`, `src/github_api.py`, `src/claude_integration.py`: Action
  execution, GitHub access, and optional AI integration.
- `src/diff_engine.py`, `src/review_core.py`: shared notebook comparison and
  review/output extraction. Preserve compatibility for both products.
- `apps/api/main.py`, `apps/api/routes/`: FastAPI entrypoint and endpoints.
- `apps/api/models.py`, `apps/api/alembic/`: persistence and schema migrations.
- `apps/api/orchestration.py`, `apps/api/worker.py`, `apps/api/worker_loop.py`:
  snapshots, queued work, and deployed worker scheduling.
- `apps/api/oauth.py`, `apps/api/github_app.py`, `apps/api/webhooks.py`: distinct
  user authorization, App signing, and webhook verification boundaries.
- `apps/web/app/`, `apps/web/components/`, `apps/web/lib/`: Next.js routes,
  reviewer UI, typed API/data helpers, and unit tests.
- `apps/web/interactive-renderer/`: bundled, isolated saved-output renderer;
  generated `public/interactive-renderer/` assets are not source files.
- `tests/`, `tests/fixtures/`, `apps/web/e2e/`: Python and browser regression
  coverage. `deploy/` owns Compose, gateway, and operator helpers.

## Development and verification

Inspect `git status` and the relevant diff first. Preserve existing edits and
avoid broad cleanup/reset commands. Use scoped patches. When delegation is
authorized, assign bounded independent tasks with non-overlapping ownership;
verify results independently before integration. Reading this guide does not
authorize publishing, pushing, merging, deploying, changing App permissions, or
exposing local services. Follow the current user's scope and approval rules.

From the repository root (Python 3.12 matches CI):

```bash
uv run --no-project --with-editable '.[test]' pytest -q -o addopts= tests
uv run --no-project --with-editable '.[dev]' python -m mkdocs build --strict
git diff --check
```

From `apps/web/` (Node 22 matches the Docker build):

```bash
npm ci
npm test
npm run typecheck
npm run lint
npm run build
npx playwright install chromium firefox webkit
npm run test:e2e
npm audit --omit=dev
```

Run focused tests while developing, then the relevant full suites. Browser
binaries may require a download; do not report skipped/unavailable browsers as
passes. Production build includes renderer bundling. Review dependency changes
and lockfiles together, inspect full audit results too, and do not force major
upgrades without compatibility testing. CI is not a substitute for browser or
authenticated live workflow acceptance.

## Notebook-first acceptance criteria

Reviewers must understand notebook changes without interpreting raw JSON.
Provide clear aligned before/after code, source line context, readable outputs,
neutral presentation of wholly added cells, and collapsed metadata details.
Place discussions at the correct notebook/cell/snapshot anchor; preserve drafts
during filtering, navigation, and refresh. Never invent historical anchor
placements or silently discard unresolved/outdated discussions.

Exercise saved Plotly and supported saved widget interactions in real browsers.
Treat notebook HTML/JS/output data as untrusted: preserve sandbox and CSP
boundaries, module allowlists, size limits, and blocked outbound requests.
Rendering saved state is not a live kernel. Unsupported custom widgets, maps,
or other outputs need explicit honest fallbacks, not fabricated functionality.

## Credentials, data, and deployments

Never print credentials, dump environment variables, read private env/key files
for routine inspection, or run full resolved Compose configuration against real
secrets. Use `config --quiet`; inspect only selected non-secret Docker fields.
Keep webhook secret, OAuth client secret, and RSA App signing key independent.
For App user authorization use that App's client credentials, not an invented
requirement for a separate OAuth App. Import RSA keys with
`deploy/configure-app-key.py` following the local acceptance runbook; preserve
its regular-file checks, private permissions, atomic replacement, and ignored
temporary filenames. Never paste PEM contents into arguments or logs.

Use synthetic notebooks and disposable test credentials. Do not copy company
notebooks, private repository identifiers, or real customer data into fixtures,
public documentation, delegated prompts, or commits. Never expose development
or test servers publicly. The acceptance gateway is production-built and
loopback-bound; a public tunnel is a separate approved exposure.

Before an approved schema deployment, inspect migration/backfill behavior and
current revision, create a private database backup, and validate that backup.
Coordinate API/worker writes during migration; API startup runs Alembic, worker
startup does not. Preserve volumes and review data. Do not use `down -v`, drop
tables, or destructive downgrade as routine recovery. Verify schema revision,
service health, port bindings, and affected authenticated workflows afterward.
