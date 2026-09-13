// Builds the sandboxed interactive output renderer that ships to
// `public/interactive-renderer/`. This bundle runs inside a
// `sandbox="allow-scripts"` iframe (no `allow-same-origin`) and must stay
// fully self-contained: no runtime `fetch`/CDN dependencies, only the pinned
// packages resolved from node_modules at build time.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";

const here = path.dirname(fileURLToPath(import.meta.url));
const outdir = path.join(here, "..", "public", "interactive-renderer");

await mkdir(outdir, { recursive: true });

await build({
  entryPoints: [path.join(here, "src", "index.ts")],
  bundle: true,
  outfile: path.join(outdir, "bundle.js"),
  format: "iife",
  target: "es2020",
  minify: true,
  sourcemap: false,
  logLevel: "info",
  banner: {
    js: "var __webpack_public_path__ = \"\";",
  },
  loader: {
    ".css": "css",
    ".png": "dataurl",
    ".svg": "dataurl",
    ".woff": "dataurl",
    ".woff2": "dataurl",
    ".ttf": "dataurl",
    ".eot": "dataurl",
  },
  define: {
    "process.env.NODE_ENV": '"production"',
  },
});

// Inline the bundled CSS directly into the shipped HTML instead of
// fetching it over `<link rel="stylesheet">`. The renderer iframe is an
// opaque-origin sandbox (`allow-scripts`, no `allow-same-origin`), so
// `'self'` never matches its CSP; inlining avoids needing a broader
// host-based style-src allowance just to load our own stylesheet.
const cssPath = path.join(outdir, "bundle.css");
let inlineCss = "";
try {
  inlineCss = await readFile(cssPath, "utf8");
  await rm(cssPath);
} catch {
  inlineCss = "";
}

// CSP for a sandboxed opaque-origin document cannot use `'self'` (there is
// no origin to match), and a fixed nonce would offer no real protection for
// a static asset that never varies per request. Instead, hash the exact
// bundle.js bytes and require that hash both via CSP `script-src` and via
// the script tag's own `integrity` attribute: any tampering with the
// shipped bundle breaks both checks simultaneously.
const bundleJsPath = path.join(outdir, "bundle.js");
const bundleJsBytes = await readFile(bundleJsPath);
const bundleHash = createHash("sha256").update(bundleJsBytes).digest("base64");
const integrityValue = `sha256-${bundleHash}`;

const templateHtml = await readFile(path.join(here, "index.html"), "utf8");
const finalHtml = templateHtml
  .replace(
    '<link rel="stylesheet" href="./bundle.css" />',
    `<style>\n${inlineCss}\n    </style>`,
  )
  .replaceAll("__BUNDLE_SCRIPT_HASH__", integrityValue);
await writeFile(path.join(outdir, "index.html"), finalHtml);

console.log(`Interactive renderer bundle written to ${outdir}`);
console.log(`bundle.js integrity: ${integrityValue}`);
