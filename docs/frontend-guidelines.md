# Frontend guidelines

Read this page before changing any frontend layout, styling, component, or
interaction. These are NotebookLens house rules, informed by GitHub Primer and
WCAG 2.2. They are not a claim that the current application meets every rule or
has been accessibility-certified. Record exceptions and their rationale in the
change description; do not silently introduce a competing design system.

## Start with the notebook review task

The reviewer needs to find a notebook, understand code and result changes, ask a
contextual question, follow its discussion, and return without losing work.

- The notebook is the review surface: present a continuous document with outputs
  directly beneath their cells, left-gutter comment controls, and editors below
  the relevant anchor. Avoid turning each cell into a dashboard card.
- Keep notebook navigation and the current notebook/cell context discoverable
  while reading. Do not put the only navigation inside several disclosures or
  behind the entire notebook document.
- Prioritize code and outputs over installation details, AI settings, timestamps,
  duplicate status badges, and administrative explanations.
- Do not add a "What needs attention" summary/disclosure or generic reviewer
  guidance panel. Show necessary rendering/coverage warnings briefly in context;
  do not require expanding a dashboard summary to read the notebook.
- Do not expose notebook metadata panels or metadata-only change counters in
  the review UI. Preserve existing metadata-anchored conversations in Discussions
  with truthful context; removing metadata chrome must not hide discussions.
- Align corresponding before/after source rows. Use red for deletions and green
  for additions, together with minus/plus markers and side labels. Whole added
  or deleted cells use a single readable pane with the corresponding green/red
  source tint and markers. Apply the same added/removed meaning to Markdown and
  badges; keep plot/image content unaltered so its original colors remain truthful.
- Show moves explicitly. A moved-only cell must not silently disappear because
  its source text is unchanged. Preserve access to surrounding notebook context;
  if that context is unavailable, explain the limitation instead of fabricating it.
- Use consistent one-based cell numbers in headings, navigation, comments, and
  accessible labels. Convert internal zero-based positions in a shared formatter,
  not independently in each component.
- Preserve new-comment and reply drafts when switching blocks, notebooks,
  Changes/Discussions, output visibility, and recoverable error states. Do not
  persist sensitive drafts in browser storage without a scoped privacy decision.
- Keep unmatched/outdated discussions discoverable. Never guess an anchor just
  to make a thread appear attached. Distinguish historical placement from current
  placement, and retain a way back to the relevant content.
- Keep saved Plotly/widgets interactive inside their security boundaries. Saved
  state is not a live kernel; unsupported formats need an explicit fallback.

## One shared token and component system

Use semantic CSS variables and shared components for repeated purposes. Reuse
existing equivalents before adding tokens. Do not add arbitrary per-file color,
spacing, radius, or typography values to fix one screenshot. Extend the shared
system deliberately and test every consumer of a changed token.

The following are **NotebookLens house defaults**. Typography is informed by
[Primer typography](https://primer.style/product/primitives/typography/), and
diff fills use the light-theme additions/deletions from
[Primer's theme reference](https://primer.style/product/getting-started/react/theme-reference/).
Not every value below is a Primer requirement, and none is mandated merely by WCAG.

| Purpose | House default |
| --- | --- |
| Spacing scale | 4, 8, 12, 16, 24, 32 px |
| Panels and controls | 6 px radius |
| Inline code and small badges | 4 px radius |
| Diff rows and row-level fills | 0 radius |
| Main / secondary surface | `#ffffff` / `#f6f8fa` |
| Decorative border | `#d1d9e0` |
| Primary / secondary text | `#1f2328` / `#59636e` |
| Links and interaction accent | `#0969da` |
| Added / deleted row fill | `#e6ffec` / `#ffebe9` |
| Code / standard UI text | 13 px monospace / 14 px system sans-serif |
| Body line-height | 1.5 |
| Section / page heading | 16 px / 20 px, weight 600 |

Use relative sizing where appropriate so text remains resizable. Distinguish
headings by hierarchy, spacing, and weight instead of scaling everything up.
Use larger text only when its role warrants it, not to compensate for weak layout.

Notebook pages are flat documents: no pill-shaped cards, decorative gradients,
shadow-heavy chrome, or oversized badge clusters. Controls and disclosures are
not interchangeable with status badges. A status label must not look like the
main action; an action must not rely on a decorative badge for discoverability.

The decorative border token is not guaranteed to satisfy necessary control or
focus-boundary contrast. Use an appropriately contrasting semantic token where
the boundary conveys information. Test actual foreground/background pairs,
including hover, focus, disabled explanations, and diff selection states.

Do not install a new UI library just to follow these rules. Prefer native HTML
and the existing stack; justify any added dependency by a concrete need, security
and maintenance impact, and compatibility with the shared tokens.

## Accessibility requirements and house additions

Target [WCAG 2.2 Level AA](https://www.w3.org/TR/WCAG22/), including applicable
Level A requirements. This checklist is not an exhaustive conformance assessment:

- Normal text contrast at least 4.5:1; qualifying large text at least 3:1
  (1.4.3). Necessary UI/graphical information needs 3:1 non-text contrast (1.4.11).
- Do not communicate changes by color alone (1.4.1).
- Support keyboard operation, visible and unobscured focus, logical focus order,
  and bypassing repeated navigation (2.1.1, 2.4.1, 2.4.3, 2.4.7, 2.4.11).
- Give controls programmatic names, roles, states, and associated labels
  (3.3.2, 4.1.2). Use native buttons, links, inputs, and disclosures where suitable.
- Meet 24×24 CSS-pixel target sizing or a documented permitted exception
  (2.5.8). Our preferred touch target is 44×44, a house preference, not the AA minimum.
- Support 200% text resizing and reflow at 320 CSS pixels, respecting specified
  exceptions for genuinely two-dimensional content (1.4.4, 1.4.10).
- Identify errors and expose relevant status changes programmatically without
  forcing unnecessary focus changes (3.3.1, 4.1.3).

Additional house requirements: honor reduced-motion preferences, including
programmatic smooth scrolling; test both light and dark presentation explicitly.
These are implementation targets, not claims that both modes already work.
Keep a visible main-content landmark in every review view and provide a skip
link. Test real keyboard navigation rather than inferring it from JSX alone.

## Required verification before calling UI work complete

1. Run frontend unit tests, typecheck, lint, and the production build. Run relevant
   backend tests when changing actions, forms, payloads, or authorization behavior.
2. Use Playwright at 1440, 1280, and 390 px viewport widths; record heights. Exercise
   200% text zoom, narrow reflow, keyboard-only operation, focus visibility, and
   long notebook paths/source lines. Contain necessary code/table scrolling instead
   of causing whole-page horizontal overflow.
3. Inspect screenshots, not only assertions: source alignment, deletion/addition
   markers, green added/red removed cells, readable output, navigation, cell labels, draft
   continuity, and discussion placement must all be clear at each viewport.
4. Cover ready, empty, loading, error, success, historical, and disabled states.
   Disabled actions need an understandable reason. Recoverable failures must not
   silently discard the reviewer's work; status feedback must be perceivable.
5. Verify create/reply/resolve behavior through the actual route/action boundary,
   including failed requests and return-to-anchor behavior. A fixture can prove
   rendering or local interaction, not authenticated GitHub mutation success.
6. Test output frames, light/dark contrast, reduced motion, and absence of browser
   console/runtime errors. Do not weaken CSP, authentication, or sandboxing to
   satisfy a visual test. Test Chromium, Firefox, and WebKit for changed shared
   rendering behavior; unavailable browser binaries are not passing evidence.
7. Report the exact source revision, fixture/scenario, viewport, and verification
   scope. Keep baseline and after-change screenshots separate. Do not compare an
   unminified fixture bundle with production asset weight or call load time TTI.

Use synthetic data only. Do not include real notebooks, personal identifiers,
credentials, private paths, or temporary deployment URLs in artifacts or reports.

## Current debt is separate from the standard

Do not treat this document as proof that the implementation is finished. Consult
[the UX plan](review-ux-plan.md), [replacement scope](replacement-plan.md), and
current code/test evidence for status. The following are verification areas,
not a claim that each feature is missing. Preserve fixes already established
and record any remaining broader-case gaps in:

- repository/notebook selection and always-discoverable navigation;
- full notebook context and moved-only cell visibility;
- draft preservation across all transitions and mutation failures;
- accessible status feedback and landmarks in every view;
- reduced motion and fully tested light/dark presentation;
- supported saved-output formats and authenticated end-to-end acceptance.

When resolving a gap, update its evidence in the progress documents. Keep the
house rules stable unless a reviewed, documented design decision changes them.
