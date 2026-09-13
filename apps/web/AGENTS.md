# Frontend development instructions

Before changing UI code, styles, layout, or interactions, read
[the frontend guidelines](../../docs/frontend-guidelines.md) in full. The root
`AGENTS.md` still applies. These instructions do not authorize deployment or publishing.

- Use one shared token/component system and the documented Primer-inspired house
  defaults. No ad hoc per-file styling, pill-card chrome, or unexplained exceptions.
- Prioritize notebook code/results and contextual discussions. No metadata review
  panels; retain existing conversations without hiding or fabricating anchors.
- Keep Home visible in workspace navigation, team/account settings in the header,
  and the push selector beside push details. Do not move essential navigation
  below the notebook. Menus must support Escape, outside dismissal, visible focus
  at jump destinations, and targets unobscured by sticky headers.
- Reuse `WorkspaceTopbar` for home, review, settings, and recovery/not-found
  surfaces. Keep brand/Home typography, header outer width, padding, and control
  styles identical; put page-specific review controls below the shared bar.
  Readable form bodies may be narrower than notebook diffs.
  Use `WorkspaceSettingsMenu` on every shared bar; show sign-out only for verified
  authentication and team AI settings only with a known review-context route.
  Unknown access is not a confirmed logout. Keep the opaque header background
  consistent with the page in both themes; retain visible Home on error pages.
  Test computed header geometry across these pages at the same viewports, including 1920 px as well as
  1440, 1280, and 390 px, so max-width differences do not hide in smaller tests.
- Preserve drafts across blocks/views and errors; keep cell labels consistently
  one-based. Do not let moved cells disappear under unchanged-source filtering.
- Align each comment gutter button with the actual source pane or output card,
  not a separate caption row. Preserve accessible block labels and visible
  output provenance. Test button-to-content geometry for mixed Markdown, code,
  and outputs at the required widths in both light and dark themes.
- Use semantic keyboard-operable controls and verify contrast, focus, zoom/reflow,
  target sizes, status announcements, and light/dark/reduced-motion behavior.
  Requirements are targets; do not claim current accessibility certification.
- Validate screenshots and actual behavior in Playwright at 1440, 1280, and 390 px.
  Separate synthetic component evidence from real route/OAuth/GitHub acceptance.
- Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, and relevant
  `npm run test:e2e` coverage from this directory. Verify empty/loading/error/success
  and disabled states, draft continuity, and console/runtime errors.
- Preserve authentication, CSP, sandboxing, and private data boundaries. Use
  synthetic fixtures. Document remaining debt and any deliberate guideline exception.
- Keep settings success, expired-session, forbidden, missing-resource, and service
  failure states in the same compact shell with visible Home and Back navigation.
  Explain recovery without exposing raw upstream errors or implying repository
  write access grants installation administration. Test actual route branches
  with mocked authorization results; never bypass permissions to fix an error UI.
- Test authenticated GET and POST with the actual Next runtime, not only mocked
  headers. Mutable cookie stores can differ from readonly page stores: use
  `getAll()` and request-cookie serialization, not `.size` or Set-Cookie strings.
  Thread route handlers must forward cookies from their actual `NextRequest`,
  not ambient `cookies()` request state. Pass an explicitly empty header for
  anonymous requests; never substitute another session or accept cookies from
  form/query fields. Preserve backend authentication and test all four actions.
