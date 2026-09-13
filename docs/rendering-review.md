# Phase 2 independent rendering review

Opus reviewed the in-progress interactive renderer on 2026-09-13. This is a
working review log, not a replacement-readiness claim. The original findings
below now have fixes and regression evidence recorded afterward. Final Opus
review found one additional stylesheet blocker, fixed and verified below;
phase 3 and full replacement readiness are not complete.

1. Widget allowlist checks only envelope model_module; also validate the saved
   state's _model_module and _view_module and class names. Prevent a controls
   envelope from smuggling an OutputView or unauthorized module. Align backend
   and frontend allowlists; missing/default module fields need explicit handling.
2. Frame navigation can preserve WindowProxy identity. A repeated renderer-ready
   must never cause private payload resend to a navigated frame. Send once per
   keyed iframe instance, latch readiness, and sanitize HTML-bearing widget data
   to remove navigation/resource-bearing content before set_state. Test repeated
   ready events, HTML widget values/descriptions and navigation.
3. A fresh request object each workspace render resets loading state while the
   already loaded iframe never sends ready again. Opening a comment must not
   destroy rendered figures. Stable request identity or explicit keyed remount
   plus one-shot handoff must address both this bug and finding 2.
4. Static CSP nonce must be removed/replaced; prefer hashes for fixed bootstrap
   code. Verify whether unsafe-eval is actually necessary and minimize it. Keep
   restrictions against arbitrary notebook scripts and remote resources.
5. Allowlist Plotly config and apply hardened flags last; do not accept cloud
   upload/edit links, arbitrary topojson URL or injected modebar controls.
6. Add header-level frame-ancestors and nosniff policies for renderer assets;
   frame-ancestors in meta does not work. Include style-src fallback.
7. Explicitly report offline limitations for map/tile traces, unsupported widget
   versions/modules and downloads. Do not silently show blank output. Tall
   content must scroll rather than clip at a maximum frame height.
8. Normalize/contain paths in the test HTTP server. Add browser regressions for
   module smuggling, payload resend, workspace rerenders, HTML navigation and
   external requests; trivial bar rendering alone does not prove isolation.

Source locations at review time: apps/web/lib/interactive-output.ts,
components/interactive-output-frame.tsx, components/review-workspace.tsx,
interactive-renderer/index.html, interactive-renderer/src/index.ts,
interactive-renderer/build.mjs, e2e/interactive-renderer.spec.ts.

## Resolution and verification, 2026-09-13

1. Backend/frontend module allowlists now agree on base/controls and validate
   inner module references. Class resolution requires an own exported function,
   rejecting inherited `constructor`/`toString`. Upstream ManagerBase catches
   class-load errors and substitutes error widgets; the local manager now
   preserves that failure and explicitly reports rejection instead of success.
2. Parent handoff is latched once per iframe and checks source-window identity.
   HTML-bearing widget data is sanitized, including meta tags and resource/
   navigation attributes. Repeated-ready, hostile HTML and meta-refresh tests
   verify no payload resend or external request/navigation for those cases.
3. Same-reference item rerenders preserve the iframe and ready height. Changed
   items get a fresh keyed iframe and request identity; stale frame messages
   are ignored. Both paths have component regression tests.
4. Static nonce and the eval-dependent HTMLManager were removed. A minimal
   saved-widget manager uses bundled base/controls; build-time SHA-256 plus SRI
   permits the trusted bundle without `unsafe-eval`. Actual renderer tests pass
   in Chromium, Firefox and WebKit.
5. Plotly configuration is allowlisted with forced cloud/download restrictions.
   Data/layout strings are sanitized. Map traces are explicitly unsupported.
6. Next headers configure frame-ancestors and nosniff. CSP has style-src fallback
   and the build inlines local CSS. Live proxy/header preservation still needs
   deployment acceptance; browser harness success does not prove that wiring.
7. Unsupported modules/versions and maps produce explicit notices; tall content
   scrolls at the frame height cap. Compatibility limitations remain below.
8. The harness resolves/contains paths within public. Real-browser regressions
   cover plots/sliders, module smuggling, inherited classes, HTML/meta navigation
   and external requests; component tests cover handoff/rerender lifecycle.

Evidence: backend **135 passed**; frontend unit/component **99 passed**;
real-browser **27 passed**, nine cases each across Chromium, Firefox and WebKit,
independently rerun by the main agent after the class-error fix. Typecheck and
renderer rebuild passed after that fix. Typed test spies and Error normalization
then cleared lint; full production build and five focused component regressions
also passed.

Final Opus review identified a stylesheet omission: importing widgets-base.css
alone leaves Jupyter theme variables undefined. Package inspection confirmed
widgets.css includes labvariables.css and widgets-base.css. The renderer now
imports that full entrypoint. The slider browser case checks theme tokens,
the computed 13px label font and noncollapsed widget dimensions. Renderer build,
lint and all **27 browser tests passed** after this fix (13.5 seconds). The earlier
production build predates this stylesheet-only production change. Other security
checks in that review found no additional blocker; compatibility limits below
remain acceptance work.

## Focused source anti-pattern checklist

Inspected renderer source/build template, interactive/HTML validation, iframe
component and Next headers. This is not a complete third-party bundle audit.

- No executable eval or Function constructor in the inspected first-party
  runtime. `new Function` and `unsafe-eval` mentions explain the removed
  dependency path in comments; actual CSP does not grant unsafe-eval.
- The actual interactive iframe grants only allow-scripts. Allow-same-origin
  appears in explanatory comments describing its absence, not its sandbox value.
- Dynamic imports use fixed local package names bundled at build time; no
  notebook-controlled remote loader. Hostile URLs in tests are attack fixtures.
- No evaluation of raw notebook scripts: HTML uses a script-disabled sandbox;
  interactive content is validated structured data passed to trusted local code.
- An iframe sandbox does not generally prevent its own frame from navigating.
  Sanitization and one-shot handoff remain necessary; CSP/source identity alone
  must not be described as sufficient navigation protection.

## Remaining compatibility and acceptance work

Plotly map/geo/tile and Folium/Leaflet compatibility remain unimplemented despite
confirmed workload usage. Offline topology resources and an operator-controlled
tile policy need implementation/testing. Custom widget modules, Output widgets
and older widget module versions are unsupported by the current ipywidgets-8
base/controls renderer. Saved widgets are not a live Python kernel; missing
state is explicit. Plotly image download and cloud controls are restricted.

Discussion lifecycle/synchronization (phase 3), commit/standalone reviews
(phase 4), production recovery and live GitHub App acceptance (phase 5) remain
unfinished. Rendering tests do not establish full parity or license retirement.
