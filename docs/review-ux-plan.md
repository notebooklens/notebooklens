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

## Discovery and allowed interfaces

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
  Do not invent details. Added-cell metadata is included, not an edit.
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
3. Collapse metadata and routine context, remove repeated Changed badges, and
   reduce the navigation rail to compact links/counts. Keep metadata discussions
   reachable; jumps must expand disclosure ancestors.
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
