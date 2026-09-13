/**
 * Helpers for rendering bounded notebook HTML output (e.g. pandas DataFrame
 * tables) safely. The resulting document is always embedded in an
 * `<iframe sandbox="">` with no `allow-scripts`, so nothing here ever
 * executes as script inside the parent page; the CSP and script-tag
 * stripping below are defense in depth against unexpected sandbox
 * misconfiguration, not the primary control.
 */

/** Removes `<script>` elements from untrusted HTML before it is embedded. */
export function stripScriptTags(html: string): string {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "").replace(/<script\b[^>]*\/?>/gi, "");
}

/**
 * Wraps bounded notebook HTML output in a standalone document with a strict
 * CSP that blocks all network access (including image/font/style loads),
 * for use as an `<iframe srcDoc>` value. The iframe itself must be
 * `sandbox=""` (no `allow-scripts`) so this is belt-and-suspenders, not the
 * only protection.
 */
export function buildSandboxedHtmlDocument(html: string): string {
  const safeHtml = stripScriptTags(html);
  return `<!doctype html><html><head><meta charset="utf-8" /><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'" /><style>body{margin:8px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:13px;color:#0f172a;overflow-wrap:anywhere;}table{border-collapse:collapse;}td,th{border:1px solid #cbd5e1;padding:4px 8px;}</style></head><body>${safeHtml}</body></html>`;
}
