# Frontend dependency security gate

Verified 2026-09-13 with the npm advisory service after updating the web lockfile:

- `npm audit --omit=dev`: zero known vulnerabilities, independently confirmed.
- Full `npm audit`: zero critical/high; two moderate dependency findings remain
  for Vitest and `@vitest/mocker`, both from
  [GHSA-82fw-gwwq-j7x9](https://github.com/advisories/GHSA-82fw-gwwq-j7x9).
  These are development-only dependencies. The remaining fix requires a
  separately tested major Vitest migration; no forced major upgrade was made.
- Verification: 99 unit/component tests, typecheck, lint, production build and
  27 browser tests across Chromium, Firefox and WebKit passed.

Next, its ESLint plugin and config are pinned to 15.5.25. Vitest 3.2.7 removes
the previously reported critical issue without a direct major upgrade. ESLint
9.39.5 stays within the existing major, although npm marks that line deprecated;
a supported-major migration remains maintenance work.

Explicit overrides are security constraints, not general upgrade policy:

- PostCSS 8.5.23 replaces Next's exact vulnerable 8.4.31 dependency while
  remaining on PostCSS major 8.
- Sharp 0.35.4 contains the relevant native-library fixes and is within Next
  15.5.25's declared optional dependency range.
- Nanoid 3.3.18 is scoped to `nanoid@^3.0.0`; packages requiring other majors are
  not forced to downgrade. The inspected dependency tree uses it via PostCSS.

Vite resolved to 7.3.6 within Vitest's declared supported dependency range;
there is no forced Vite override. Recheck advisories whenever dependencies or
deployment images change. A clean audit is point-in-time evidence, not proof
that the application has no vulnerabilities.

Never expose the Vitest UI, its development/test server, or the Next development
server publicly. Deploy the production build with `next start`; do not use test
or development servers as an acceptance gateway.
