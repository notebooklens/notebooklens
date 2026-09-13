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
[frontend guidelines](docs/frontend-guidelines.md),
[local acceptance](docs/local-acceptance.md),
[platform deployment integration](docs/platform-deployment.md), and
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

For authorized automation-authored commits, set a non-personal author and
committer identity per command (for example, `NotebookLens Automation` and
`automation@notebooklens.invalid`). Do not inherit a personal local Git profile
or change global Git configuration. Preserve existing human attribution by
default; rewriting history requires explicit approval.

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
NOTEBOOKLENS_NEXT_INTEGRATION=1 npm run test:e2e -- e2e/thread-next-integration.spec.ts --project=chromium --workers=1
npm audit --omit=dev
```

Run focused tests while developing, then the relevant full suites. Browser
binaries may require a download; do not report skipped/unavailable browsers as
passes. Production build includes renderer bundling. Review dependency changes
and lockfiles together, inspect full audit results too, and do not force major
upgrades without compatibility testing. CI is not a substitute for browser or
authenticated live workflow acceptance.

Before calling a PR ready, run the **full backend test suite** and audit every
registered API path/method against test coverage; a passing test count alone is
not evidence that every API works. Cover successful operations, malformed input,
missing/expired authentication, insufficient permissions, missing resources,
and upstream failures where applicable. For discussion changes, exercise create,
reply, resolve, and reopen through both the web action boundary and API, including
draft retention and visible errors. Run the opt-in real-Next integration above
when changing comment forms/navigation; the default mocked-router suite cannot
prove server refresh preserves other drafts. Use isolated databases, synthetic identities,
and mocked GitHub/AI/email boundaries; never test destructive or billable actions
against a real deployment without explicit authorization. Report endpoint gaps,
skips, and which checks are mocked versus authenticated live acceptance. After a
local restart, verify that the running service versions and schema support the
tested UI contract; health checks alone do not prove comment submission works.

## Notebook-first acceptance criteria

Reviewers must understand notebook changes without interpreting raw JSON.
Provide clear aligned before/after code, source line context, readable outputs,
green additions and red removals (including whole cells), and no metadata review chrome.
Preserve existing metadata-anchored conversations in Discussions. Read the
frontend guidelines in full before UI changes; `apps/web/AGENTS.md` adds the
frontend-specific verification requirements.
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
