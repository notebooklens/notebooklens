# Data-scientist review UX

Goal: make actual notebook changes and the conversations about them easy to
understand. This increment is not a full ReviewNB replacement claim.

Reference clarification: the user's screenshots demonstrate a repository-first
entry, notebook/commit/PR choices, a PR changes/discussion split, expandable
notebook files, continuous notebook content, gutter comment controls and output/
previous-version visibility switches. Match the workflow, not brand styling.
Do not copy company repository names or notebook source into public fixtures.
Repository/commit browsing is separate backend scope: never add dead tabs or
present saved PR pushes as individual commit review.

## Initial discovery and allowed interfaces

This section records the starting implementation, not current completion status.
Check the current source and verification evidence before treating a gap as open.

- `components/review-workspace.tsx`: CellRowCard, BlockContent, ThreadCard,
  InlineThreadComposer and existing form actions are the integration points.
- `lib/code-diff.ts`: computeLineDiff currently returns separate unaligned
  sides. Keep its bounded LCS guard; introduce aligned rows additively.
- `lib/review-workspace.ts`: anchor IDs, composer toggling and flash redirect
  helpers already exist. Preserve a validated local fragment after mutation;
  never allow external return URLs or weaken session checks.
- Render tests in `lib/review-workspace-render.test.ts` and jsdom component
  tests provide existing fixture/assertion patterns. Update assertions that
  require collapsed open discussions: that old behavior is being replaced.
- Metadata payload has only changed/summary, not structured key changes.
  Do not invent details or display per-cell metadata review panels. Existing
  metadata-anchored conversations remain available in Discussions.
- `app/page.tsx` ignores authentication. A signed-in landing view needs a real
  authorized session/review-list API; cookie presence alone is not identity.
- Public workflow reference: https://docs.reviewnb.com/ (visual diffs and
  conversations on diffs); this implementation does not copy proprietary UI.

## Phase 1: clear changes and contextual discussions

1. Align before/after source lines with explicit blank alignment rows, original
   line numbers and text +/- markers, not color alone. Label bounded fallback.
2. Label Before/After clearly, compare output sides where present, and handle
   added/removed cells without suggesting that an absent side is an error.
   Preserve legacy outputs without side markers rather than assigning a side.
3. Following the latest product direction, remove per-cell metadata UI and
   metadata-only change counters, rather than collapsing them. Keep valid
   metadata conversations and their original anchors reachable in Discussions;
   hiding metadata content must not mark a valid thread as drifted. Collapse
   routine context and remove repeated Changed badges. Keep navigation compact;
   jumps to visible content must expand disclosure ancestors.
4. Open unresolved conversations inline; resolved threads remain expandable.
   Make Reply and Resolve direct actions with labeled composers. Keep existing
   server action authorization, preserve return fragments and avoid duplicate
   submit behavior. Surface drifted/unmatched discussions without false anchors.
5. Verify modified existing-notebook fixtures, insert/delete alignment,
   output-only changes, metadata-only changes and keyboard/thread interactions.
   Do not treat the current all-added fixture PR as sufficient diff acceptance.
6. Present expandable notebook documents rather than a grid of cell cards.
   Added/deleted notebooks use a green/red single-version view with markers; modified cells use
   aligned comparisons. Provide accessible gutter comment buttons, outputs and
   previous-version visibility controls, and Changes/Discussions navigation.
   Open discussions stay adjacent to their cell. No full-height dashboard rail.

## Current refinement direction

Use [the shared frontend guidelines](frontend-guidelines.md): green additions,
red deletions, textual markers (including wholly added/deleted cells), and one compact
token-based theme instead of pill-shaped cards and decorative chrome. Keep
one-based cell labels consistent, show moved-only cells, and preserve drafts
when changing comment blocks and review views. Broader navigation/error recovery
cases still require explicit evidence.

AI settings follow the same tokens and clearly distinguish saved configuration
from testing. Keep existing field names and payload semantics, never read back
stored secrets, disclose advanced controls when validation fails, and make
pending/error/success states accessible. A synthetic form test is not a live
gateway or provider test. Record final verification below only after independent
checks; source changes alone do not close the acceptance gate.

### Refinement verification — 2026-09-13

Independent verification of the refinement working tree passed frontend unit
tests, type checking, lint, production build, and the standard browser regression
suite across Chromium, Firefox, and WebKit: 130 unit tests and 57 browser cases
passed. The optional observational audit
cases were explicitly skipped by their opt-in gate, not counted as passing tests.

Regression coverage exercises red/green source changes with textual markers,
the then-neutral added cells, moved-only visibility, matching one-based comment labels,
comment-draft restoration between blocks, metadata-free Changes with existing
metadata discussions preserved, and narrow-screen layouts. Shared disclosure
radii and reply/resolve layout have computed-style checks.

Independent review also caught a deleted-cell contract mismatch: the backend
uses `deleted`, while an earlier renderer branch recognized only `removed`.
The renderer now accepts both and preserves the original source/output even
when Show previous version is off; all three browsers cover that regression.

AI form tests preserve save/test intents and pending FormData behavior, keep
stored secrets absent from initial inputs, and exercise failed requests and
invalid advanced fields, including disclosure reopening and focus. These tests
use a synthetic action, not a real provider. Header-validation errors were also
checked not to echo supplied header names/values. AI light/dark and reduced-motion
presentation were exercised; this is not a claim of application-wide WCAG AA
conformance or completed full-notebook/real-provider acceptance.

### Latest whole-cell color direction

The user subsequently requested that additions be green and removals red,
including whole added/deleted cells. This supersedes the earlier neutral-added
rule. Keep a single source pane for one-sided cells, but show every source line
with its addition/deletion color and plus/minus marker. Whole-cell Markdown
uses the matching tint and explicit Added/Removed label; notebook, cell and
output badges use the same semantics. Do not alter image or chart pixels.
Verification of this subsequent slice is recorded separately from the earlier
130-unit/57-browser milestone above.

## Phase 2: signed-in entry and integration

The session-aware homepage and access-filtered repository/review APIs are now
implemented and covered by isolated tests. The homepage is a repository picker,
not a static marketing illustration; it does not fabricate notebook or commit
browsing. Invalid
sessions still get sign-in. No tokens or private unauthorized repository names
are included in responses. Service errors have a retry state, not a false logout.
Keep the following contract and release checks when extending the entry flow.

Allowed entry contract (confirmed against existing auth/models/api wrapper):
- `GET /api/session` reuses `require_authenticated_user` and returns only user
  login/ID, never the session ID or OAuth token. Missing/expired session is 401.
- `GET /api/repositories` lists bounded pages of active known installation
  repositories, checking actual user access before serializing each item. Use
  opaque ID cursors, not inaccessible repository names, and cap remote calls.
  A page can be empty after filtering and still have a next cursor.
- Group a bounded number of existing ManagedReview rows per allowed repository.
  Do not invent PR titles (not stored), commits or not-yet-indexed notebooks.
  Label this as repositories with available reviews, not all GitHub content.
- Web calls reuse `apiRequest` (cookie forwarding, no-store). Anonymous users
  see sign-in; valid sessions see repository selection and actual PR links;
  service failures get an honest retry state, not false signed-out UI.
- Verify unauthorized/inactive repositories omitted, invalid session rejected,
  pagination bounded, and the signed-in homepage has no login loop.

### Follow-up verification — 2026-09-14

The "What needs attention" disclosure and its generic findings/guidance panel
were removed. Necessary rendering notices remain directly visible. Added and
removed code/Markdown, including whole cells, now use green/red with explicit
signs/labels. The notebook remains the review surface: source, outputs, and
inline editors share one document rather than separate dashboard cards.

An actual local reverse-proxy defect was reproduced without a real mutation:
thread action redirects used the container's internal origin. All four thread
actions now use sanitized relative redirects, plus JSON responses for enhanced
forms. Errors retain the submitted draft beside its block; pending requests
disable duplicate submission. Successful forms clear their own draft and request
a Next refresh rather than reloading the entire document. Cross-snapshot/full
reload recovery remains separate work; do not claim durable draft storage.

Backend verification now inventories 20 application method/path pairs. The full
suite passes 240 cases with isolated databases and mocked external services.
Frontend unit coverage passes 160 cases. The standard browser suite passes 81
cases across Chromium, Firefox, and WebKit, including repository selection,
comment submission through the actual web handlers with a substituted API,
failures/auth expiration, and retained unrelated drafts. Optional audit/real-Next
cases are excluded from that passing count. This is not live GitHub acceptance.
The opt-in Chromium real-Next/RSC test also passed separately: a synthetic HTTP
API accepted a comment, the refreshed UI showed its new thread, and unrelated
comment/reply drafts remained. It uses actual Next navigation but no real user
session or GitHub write.

Saved Plotly HTML containing one literal JSON `Plotly.newPlot` call now feeds
the existing isolated renderer. No notebook JavaScript is executed. Dynamic or
multiple-chart HTML and animation frames are explicit unsupported fallbacks;
maps/geo and custom FigureWidgets remain gaps. Previously prepared snapshots
need a new build to use backend extraction changes. Do not treat a browser
refresh as reprocessing stored snapshot data.

See [platform integration](platform-deployment.md) for generic workload, secret,
ingress, and migration requirements. It is not a validated private-platform
installer or a claim of production readiness.

### Header navigation and authenticated comments — 2026-09-14

Home and the NotebookLens name now link to repository selection. Account/team
settings are in the header menu; review jumps are beside Changes/Discussions;
Switch push sits beside Push details and remains available from Discussions.
The lower notebook has no utility/settings rail. Dropdowns use native disclosures,
Escape/outside dismissal, correct overlay stacking, selected-push semantics,
and keyboard focus at jump destinations below the sticky header.

The real-Next regression now requires a synthetic session cookie on both review
GET and comment POST. This exposed a second, distinct comment bug: mutable Next
cookie stores have no `.size`, so the API helper silently omitted the session on
POST. The helper now serializes `getAll()` as request-cookie pairs; it does not
forward Set-Cookie attributes or weaken API authentication. The enhanced regression
failed before that fix and passed afterward, preserving unrelated drafts.

Verification: 240 backend tests, 162 frontend tests, and 90 standard browser
cases passed; 12 opt-in cases were skipped by the standard run. The authenticated
real-Next Chromium case passed separately with a synthetic API, not live GitHub.
Navigation screenshots and interactions cover 1440×900, 1280×900, and 390×900
across Chromium, Firefox, and WebKit. Actual user-session acceptance is separate.

### Contextual toolbar and truthful discussion state — 2026-09-14

The review header is compact, with version selection and push details in the
upper controls. Changes has notebook/change navigation and display options;
Discussions has All/Open/Resolved filtering and contextual notebook jumps instead
of irrelevant display switches. Details use labeled rows rather than squeezed
metric cards. Existing notebook/anchor identity and drafts remain intact.

Version history uses actual head-commit subjects for newly prepared snapshots,
with saved-version time, short SHA, and push identity as secondary information.
The worker performs bounded authenticated enrichment and caches it in existing
snapshot JSON by installation repository and SHA. Old snapshots retain an honest
missing-subject fallback; no database migration or automatic history backfill is
required. A saved push is not an individual-commit review feature.

The web API boundary now normalizes the backend's nested `github_mirror` contract.
A shared JSON fixture is verified against the actual Python serializer and used
by frontend tests. Posted/pending/failed/skipped states and direct links therefore
use the real payload rather than unrelated flat fixture fields. Resolution is
explicitly local to NotebookLens: GitHub receives a notice, not native thread
resolution; GitHub replies are not automatically imported. Neither two-way sync
nor full ReviewNB parity is claimed.

Discussion rows expose context and cell jumps, resolved conversations remain
expandable, and successful mutations announce feedback locally rather than
leaving a permanent page-wide banner. The actual Next runtime regression covers
resolving from the Open filter when the fragment does not change: focus returns
to visible review content and unrelated drafts survive refresh. AI settings now
share their navigation/shell for success, signed-out, forbidden, missing-resource,
and service-error states; malformed API-origin configuration cannot break the
recovery page a second time. Permissions and stored secrets are unchanged.

Verified working-tree evidence: 254 backend tests passed on Python 3.12; 178
frontend unit tests, typecheck, lint, and production build passed. The standard
browser run passed 99 cases across Chromium, Firefox, and WebKit; 12 opt-in cases
were skipped and are not counted as passes. The opt-in actual-Next Chromium case
passed separately with a synthetic authenticated API, not a real GitHub session
or write. A separate focused picker run passed 12 cases across the three
browsers, including signed-in dark-theme and signed-out loading/failure states.
The measured picker text contrast was 7.49:1; this is a scoped measurement, not
application-wide accessibility certification.

The [API contract inventory](api-contract-verification.md) records all 20
registered application method/path pairs and their observed statuses, together
with missing malformed/missing-resource/upstream outcome coverage. Passing the
suite does not establish that every API failure branch works. Live deployment,
actual account permission diagnosis, native GitHub resolution/inbound replies,
cross-version durable drafts, and previously documented rendering/parity gaps
remain separate acceptance work. No live acceptance is inferred from synthetic
screenshots or local health checks.

### Shared navigation and existing-version titles — 2026-09-14

Home, reviews, AI settings, and their recoverable error/not-found states now use
one compact navigation component. The NotebookLens brand/Home links and settings
placement stay consistent while each page retains its own task context. The
review surface keeps notebook content prominent with tighter cell spacing;
history entries use compact subject-first rows with saved time, SHA, and push
identity as secondary information. Dark-theme and responsive shell styling are
shared rather than relying on the old decorative error layout.

The scoped operator backfill filled actual commit subjects for all nine existing
pilot snapshots without rebuilding them. A private backup was restored and
validated first; counts and hashes proved that all snapshot data other than the
new title metadata, and all thread/message data, remained unchanged. A repeated
dry run found nine unchanged snapshots and made no requests or writes. The
reusable operator tool defaults to dry run, requires an exact review/repository/PR
selector, bounds its batch, retries missing titles deliberately, and uses
compare-and-swap updates to avoid overwriting concurrent changes. See the
[operator runbook and integrity evidence](local-acceptance.md#backfill-commit-subjects-on-existing-snapshots).

Verified working-tree evidence for this slice: 269 backend tests on Python 3.12,
184 frontend unit tests, and 132 standard browser cases across Chromium, Firefox,
and WebKit passed. The standard run skipped 12 opt-in cases; skips are not passes.
API, worker, and web Docker image builds also passed. A separate focused
responsive run passed 12 cases, and the actual-Next Chromium integration case
passed with a synthetic authenticated API. The final gutter/dark-contrast
refinement passed nine focused mixed-cell cases across Chromium, Firefox, and
WebKit at 1440, 1280, and 390 pixels, with measured text contrast at least 4.5:1
immediately after switching themes. No full accessibility, two-way GitHub synchronization,
or ReviewNB replacement acceptance is inferred from these checks.

### Content-aligned controls and shared settings — 2026-09-14

Comment controls now sit beside actual source/output content rather than a
separate block-heading row. Before/After labels remain in output cards, and
legacy outputs retain a visible comparison-side-unavailable notice. The shared
topbar uses the surrounding page background; Home, review, AI settings, and
recovery pages share one keyboard-operable Settings disclosure. Account actions
reflect verified authentication, unknown access remains explicit, and pages
without review context do not invent team-AI links. Existing logout redirect
sanitization and permission checks are unchanged.

Verification before the request-cookie fix: 185 frontend unit tests, typecheck, lint, production build, and
the web Docker image build passed. The first standard three-browser run passed
125 cases, skipped 12 opt-in cases, and failed seven: six outdated selectors
after moving Settings actions, and one saved-widget timeout. After correcting
the selectors, all 24 focused AI/Home cases passed across the three browsers;
the exact widget timeout case passed on retry. This is not a claim that the
entire standard suite was rerun successfully. Nine focused mixed-cell cases
also passed across the three browsers, and an independent reviewer reran 49
route/Home/AI/render unit cases successfully. The isolated actual-Next test
intermittently failed with a 502 before the synthetic API received a comment
POST. Initial retries and three baseline runs passed, but candidate failures
recurred. Isolated diagnostics identified `cookies()` being called outside its
request scope in the POST action. Thread handlers now forward cookies directly
from their actual `NextRequest`; an explicitly empty cookie header remains
anonymous and never falls back to ambient request state. Independent verification
passed 38 API/action/actual-route tests, including all four thread actions and
the API's anonymous 401 response. After this fix, 190 frontend unit tests and
typecheck passed; three consecutive isolated actual-Next cases passed in 18.8
seconds. These cases use a synthetic authenticated API, not real GitHub writes.
Earlier successful retries are not counted as post-fix evidence. Final post-fix
lint, production build, and web Docker image build passed.
Twelve focused thread-action browser cases also passed across the three browsers.
Backend code,
schema, and dependencies are unchanged;
the earlier 269-test backend evidence was not rerun for this frontend-only slice.

## Release gates

Fresh verification and anti-pattern/code-quality review before commits/push.
Do not expose tokens, disable CSP/auth, fabricate review completion, or hide
unmatched discussions to make counts look cleaner. Deploy only tested changes
to the authorized test-organization pilot, retaining its data and existing secrets.
