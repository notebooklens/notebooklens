# ReviewNB replacement implementation and acceptance

Status: implementation in progress; not approved for license retirement.

Verified milestones:
- Phase 1: implemented and independently verified (48 backend tests and shell
  syntax check); commit `18f545d` on `feat/reviewnb-replacement`.
- Phase 2 checks: full backend suite passed 135 tests; frontend unit/component
  suite passed 99 tests. The main agent independently verified 27 Playwright
  cases (nine each in Chromium, Firefox and WebKit). Typecheck and renderer
  rebuild passed after the class-error reporting fix; subsequent typed-spy/Error
  normalization changes passed lint, full production build and five focused
  component regressions. Final Opus review found a missing widget stylesheet
  dependency; importing the full widgets.css entrypoint fixed it. Renderer build,
  lint and all 27 browser cases passed afterward, including computed widget
  theme/font/dimension assertions. Other reviewed security checks had no new
  blocker; full compatibility and later-phase acceptance remain outstanding.
  See `docs/rendering-review.md` for resolved
  findings and compatibility gaps; these counts do not establish full parity.

Live acceptance uses an authorized, operator-controlled test organization and
repository with synthetic notebook fixtures, not company notebook source.
Verify App installation, callback/deployment endpoints, and required permissions
against current acceptance evidence; choosing a repository or completing a
bootstrap health check does not establish full live acceptance.

Workload discovery confirmed notebook code using Plotly maps and Folium, not just
references inside bundled libraries. Map/geo rendering must therefore be assessed
before retirement; rejecting all map traces is not evidence of full parity.
Track offline topology resources and an explicit operator-controlled tile policy,
plus Folium/Leaflet compatibility, as acceptance work rather than silently
excluding them. Never expose notebook data through arbitrary network/script URLs.
Only small code-search fragments were inspected; company source, repository
identifiers and notebook paths must not be copied into the public implementation.

Required scope (confirmed 2026-09-13): GitHub PR review, individual commit
review, standalone notebook discussions, rendered outputs, Plotly and saved
Jupyter widget interactivity. Existing hosting and ownership are already borne
by the team; only verified avoidable expenditure counts as savings.

## Phase 0: documentation discovery

Baseline: local branch `fix/hosted-workspace-hardening-ui`, commit `0a98597`;
84 Python and 33 frontend tests pass. Existing PR #14 remains unmerged.

Sources and allowed interfaces:

- `src/review_core.py`: `build_review_artifacts`, `_render_output_items`,
  `_render_single_output_item`, `_build_image_output_item`; hosted payload is
  separate from the AI summary boundary. Copy image extraction and bounded
  content patterns for new output types.
- `apps/web/lib/types.ts`, `components/review-workspace.tsx:BlockContent`,
  `lib/review-workspace.ts:getMeaningfulOutputItems`: extend the discriminated
  output union and visibility predicates together.
- `apps/api/worker.py:process_github_mirror_job_once(*, settings=None,
  github_client=None)` and `tests/test_api_skeleton.py` mirror-worker helper:
  the deployed shell loop currently omits this worker.
- `apps/api/review_workspace.py:carry_forward_open_threads` and
  `anchors_match_for_carry_forward`: exact source fingerprints and paths gate
  continuity. Preserve historical anchors; never silently attach ambiguous cells.
- GitHub review comment API: https://docs.github.com/en/rest/pulls/comments
- GitHub webhook payloads: https://docs.github.com/en/webhooks/webhook-events-and-payloads
- Plotly API: https://plotly.com/javascript/plotlyjs-function-reference/
- Saved widget embedding: https://ipywidgets.readthedocs.io/en/stable/embedding.html
- Product scope: https://docs.reviewnb.com/

Discovery was delegated to local Claude; architecture and interactive-output
reviews supplement these directly checked interfaces. Saved widgets are not a
live Python kernel. Missing state and unsupported custom modules must be explicit.

Discovery correction: PR snapshot history is NOT individual commit review, and
PR threads are NOT standalone notebook conversations. `ManagedReview.pull_number`
is currently nonnullable and web/API identities all depend on PRs. Phase 4 is
required. A delegated report claiming these already existed was rejected.
The architecture report's claim that `deploy/.env.example` was absent was also
rejected: direct filesystem inspection confirms it exists. Other findings must
be verified individually. Inbound sync and non-PR reviews are required by the
user even where the initial architecture report called them optional.

Rendering contract: extend output items additively with an optional `side`
(`base` or `head`) and bounded text/HTML/Plotly/widget representations. Keep
`outputs.items` and old image/placeholder snapshots working. Preserve `side`
when persisted asset keys are rewritten. Render Markdown through a maintained
parser with raw HTML disabled; HTML outputs use a script-disabled sandbox.
Interactive output uses trusted locally packaged renderer code in an opaque
origin iframe (`allow-scripts`, never `allow-same-origin`) with network blocked
except local renderer assets. Only normalized Plotly JSON / saved widget state
enters that renderer; never eval arbitrary notebook scripts. Check postMessage
source, protocol and bounds. Custom widget modules require explicit support.

Phase 2 implementation contract (backend and frontend share this):

- Preserve old kinds `image`/`placeholder`. New items always carry `summary`,
  `change_type`, optional `side`, and `truncated` where applicable.
- `text`: `text: string`, `mime_type: string` (stream/error/plain/JSON).
- `html`: `html: string` (sandboxed without scripts; no remote resources).
- `plotly`: `spec: {data: object[], layout?: object, config?: object}`.
- `widget`: `view: object`, `state: object` (saved widget manager state).
- `side: "base" | "head"` labels both sides; legacy absent side remains readable.
- Widget state comes from each side's own notebook metadata. Reject malformed
  and oversized interactive specs visibly; never truncate JSON into broken data.
- The browser packages trusted renderer dependencies locally. Standard saved
  widgets are required. Missing state/custom modules show an explicit notice.
- Preserve old snapshot schema compatibility through additive fields. Tests
  exercise the backend-to-frontend contract including persisted asset rewriting.

## Phase 1: make the deployed worker execute the existing review workflow

Implement an importable worker loop using the existing three worker entrypoints;
invoke it from Docker's shell entrypoint. Test that mirror processing runs and
that a notification failure cannot starve other queues. Avoid duplicating queue
logic or inventing worker parameters. Verify unit tests and shell syntax.

## Phase 2: complete visual PR review

Extend the payload and renderer for bounded before/after output content, source
line changes, Markdown, HTML tables, images, Plotly and saved widgets. Copy the
existing asset authorization path and fixture construction patterns in
`tests/test_review_core.py` and `apps/web/lib/review-workspace-render.test.ts`.
Keep old snapshot payloads readable. Separate notebook content from executable
renderer code; forbid credential access, arbitrary remote module loading and
execution in the parent page. Verify real browser rendering and hostile payloads,
not just string snapshots. Include source/output-only changes and missing state.

## Phase 3: discussion correctness and GitHub synchronization

Phase 3a verified: per-snapshot thread placements now preserve matched and
unmatched discussions across forward pushes, with explicit `anchor_drifted`
and immutable origin anchors. Resolved status survives drift; duplicate matching
rows are not guessed. Migration backfills only the known origin/current
placements, not unavailable intermediate history. Full backend verification:
154 tests passed, including migration backfill and database cascade checks.

This slice retains the strict source-fingerprint matcher: unique-cell source
edits and source-line mapping remain unimplemented. Force-push/rebuild ordering
and retention still need acceptance work; backward snapshot processing is
guarded but does not reconstruct missing history. Deleting retained snapshots
can cascade discussion/history removal, so the retention policy must be reviewed
before claiming durable enterprise discussion preservation.

Preserve original anchors, make outdated discussions visible, and handle unique
stable cell identity across moves/edits without guessing on duplicates. Implement
inbound GitHub replies/edits/deletions and thread resolution using documented
webhooks, with repository/installation scoping and replay/echo protection.
Test cross-repository isolation, duplicate events, reply echo and changed cells.

Phase 3 decisions after discovery:
- Enqueue check refreshes durably with local mutations; external GitHub failure
  cannot roll back accepted text. Reuse the existing mirror outbox/worker pattern.
- Deduplicate incoming delivery IDs transactionally and scope all comment IDs to
  the installation, repository and review. Echo suppression is by recorded IDs
  or explicit correlation markers, NEVER simply by actor (the same human may
  post legitimate replies directly on GitHub).
- Use documented GraphQL review-thread resolution for real GitHub resolved state;
  a bot reply saying resolved is insufficient. Resolve the real node identifier.
- Keep resolution state and anchor freshness distinguishable; retain per-snapshot
  anchor history so reviewing an intermediate push does not lose discussions.
- Unique stable cell IDs can survive source edits. Duplicate/ambiguous IDs must
  not silently reattach; preserve an accessible outdated discussion instead.
- Source-line comments need validated side/line anchors and line-aware mapping;
  block-level comments alone are not full review parity. Keep GitHub approvals
  and change requests accessible through the actual PR, and document precisely
  which review submission controls are available inside NotebookLens.

Phase 3 shared contract:
- Optional source anchors: `source_side: "base" | "head"`, `line_start: int`,
  `line_end: int` (1-based, validated against that snapshot's cell source).
- Preserve origin anchors and persist per-snapshot anchor mappings. Serialized
  threads include `anchor_drifted` and remain available when outdated/unmapped.
- Message edit/delete uses author permission checks; deletion becomes an explicit
  tombstone. GitHub message IDs and update timestamps support inbound idempotency.
- Track GitHub review-thread node IDs for real GraphQL resolution; include
  processed-delivery persistence and bounded retry scheduling in migrations.
- Inbound handlers never infer ownership by author alone and never enqueue an
  echo of imported content. Verify installation/repository/PR identity before
  looking up a mapped thread or message.

## Phase 4: commit and standalone reviews

Extend review identity explicitly beyond pull request numbers, with migrations,
authorized creation, immutable commit resolution and usable web navigation.
Reuse snapshot/thread APIs; do not manufacture PR numbers or post non-PR
discussions through PR APIs. Test migration compatibility and all three review
types end to end.

Phase 4 design decisions:
- Add explicit review kind and stable bounded review key, make PR number
  nullable, backfill existing rows, and enforce per-kind identity. A notebook
  discussion is identified by repository/ref/path and retains snapshots as that
  ref advances; do not create unrelated discussions for every SHA. Use a digest
  for bounded keys and store path/ref separately.
- Canonicalize commit refs through GitHub, support root commits as one-sided
  additions (do not reject root commits), and paginate commit file discovery.
- Keep stored snapshot SHAs immutable. Standalone mode determines absent base
  content explicitly; do not invent PR numbers or a nonexistent parent SHA.
- Lookup active installed repository plus live user access. Installation lifecycle
  events must revoke access/disable stale installation records.
- Reuse generic UUID snapshot/thread routes and add a usable repository/ref/path
  entry UI. PR-only mirror/check behavior must be gated centrally for non-PR modes.

## Phase 5: production verification and cutover evidence

Independently review architecture, security and code quality; run backend and
frontend checks, production builds, Docker startup, migrations, database restore,
queue recovery and representative large-notebook browser scenarios. Document
installation permissions, webhook subscriptions, supported renderers and rollback.
Verify configured GitHub host wiring, health-route proxy compatibility, transient
GitHub error retries and durable local comments when external check updates fail.

Live acceptance must exercise GitHub App install/login, actual PR pushes and
two-way discussions, commit review, standalone threads, plots and saved widgets.
Record remaining unsupported formats and obtain representative team acceptance
before claiming replacement readiness or removing ReviewNB. Local unit tests do
not establish enterprise-scale or live integration parity.
Before decommissioning, inventory existing ReviewNB-only notebook discussions
and decide how to export/import or retain read access to that history. GitHub
mirrored comments alone do not establish preservation of standalone discussions.
