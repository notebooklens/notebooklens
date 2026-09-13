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
   Added notebooks use a neutral, single-version view; modified cells use
   aligned comparisons. Provide accessible gutter comment buttons, outputs and
   previous-version visibility controls, and Changes/Discussions navigation.
   Open discussions stay adjacent to their cell. No full-height dashboard rail.

## Current refinement direction

Use [the shared frontend guidelines](frontend-guidelines.md): green additions,
red deletions, textual markers, neutral wholly added cells, and one compact
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
neutral added cells, moved-only visibility, matching one-based comment labels,
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

## Phase 2: signed-in entry and integration

Implement a session-aware homepage with access-filtered review links; invalid
sessions still get sign-in. No tokens or private unauthorized repository names
in responses. Independently review the pending anchor-history backend slice
before deploying its migration. Verify homepage, diff, thread actions and output
interactivity in browser tests; run backend/frontend checks and production build.

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

## Release gates

Fresh verification and anti-pattern/code-quality review before commits/push.
Do not expose tokens, disable CSP/auth, fabricate review completion, or hide
unmatched discussions to make counts look cleaner. Deploy only tested changes
to the authorized test-organization pilot, retaining its data and existing secrets.
