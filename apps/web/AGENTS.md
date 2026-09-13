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
- Preserve drafts across blocks/views and errors; keep cell labels consistently
  one-based. Do not let moved cells disappear under unchanged-source filtering.
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
- Test authenticated GET and POST with the actual Next runtime, not only mocked
  headers. Mutable cookie stores can differ from readonly page stores: use
  `getAll()` and request-cookie serialization, not `.size` or Set-Cookie strings.
