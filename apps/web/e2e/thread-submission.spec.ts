import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { compileFunction } from "node:vm";
import { NextRequest } from "next/server";
import path from "node:path";

type TestApi = { calls: { path: string; body?: { body_markdown?: string } }[]; failStatus: number; delay: number };
type Handlers = Record<string, (request: NextRequest) => Promise<Response>>;
let server: Server;
let origin: string;
let api: TestApi;

// Real web action handlers + real React forms; only the authenticated API boundary
// and Next navigation are substituted. No real cookies, GitHub writes, or AI calls.
test.beforeAll(async () => {
  const root = path.join(__dirname, "..");
  const actionBundle = await build({
    stdin: { contents: `export { POST as create } from './app/actions/threads/create/route'; export { POST as reply } from './app/actions/threads/reply/route'; export { POST as resolve } from './app/actions/threads/resolve/route'; export { POST as reopen } from './app/actions/threads/reopen/route'; export { state } from '@/lib/api';`, resolveDir: root, loader: "ts" },
    bundle: true, write: false, platform: "node", format: "cjs", external: ["next/server"],
    plugins: [{ name: "synthetic-authenticated-api", setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/api$/ }, () => ({ path: "test-api", namespace: "api-fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "api-fixture" }, () => ({ contents: `
        export const state = { calls: [], failStatus: 0, delay: 0 };
        export class ApiRequestError extends Error { constructor(status, detail) { super(detail); this.status = status; this.detail = detail; } }
        export async function postApi(path, body) {
          state.calls.push({path, body});
          if (state.delay) await new Promise(resolve => setTimeout(resolve, state.delay));
          if (state.failStatus) throw new ApiRequestError(state.failStatus, state.failStatus === 401 ? 'Sign in required.' : 'Synthetic service failure.');
        }`, loader: "js" }));
    } }],
  });
  const compiled = { exports: {} as Handlers & { state: TestApi } };
  // Compile only our locally built test bundle, never user/notebook input.
  const loadBundle = compileFunction(actionBundle.outputFiles[0].text, ["require", "module", "exports"]) as (require: NodeRequire, module: typeof compiled, exports: typeof compiled.exports) => void;
  loadBundle(createRequire(__filename), compiled, compiled.exports);
  const handlers = compiled.exports;
  api = handlers.state;

  const browserBundle = await build({
    entryPoints: [path.join(__dirname, "workspace-harness.tsx")], bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "synthetic-next-shell", setup(builder) {
      builder.onResolve({ filter: /^next\/(image|link|navigation)$/ }, args => ({ path: args.path, namespace: "test-next" }));
      builder.onLoad({ filter: /.*/, namespace: "test-next" }, args => ({ contents: args.path.endsWith("navigation")
        ? `export function useRouter() { return { replace(path) { window.history.replaceState({}, '', path); }, refresh() { window.dispatchEvent(new Event('test-router-refresh')); } }; }`
        : `import React from 'react'; export default function Component({children, ...props}) { return React.createElement('${args.path.endsWith("image") ? "img" : "a"}', props, children); }`, loader: "js", resolveDir: root }));
    } }],
  });
  const css = await readFile(path.join(root, "app/globals.css"), "utf8");
  server = createServer((req, res) => { void (async () => {
    if (req.method === "POST") {
      const handler = handlers[req.url!.split("/").pop()!];
      if (!handler) { res.writeHead(404).end(); return; }
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk as Uint8Array));
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) if (typeof value === "string") headers.set(key, value);
      const response = await handler(new NextRequest(`http://0.0.0.0:3000${req.url}`, { method: "POST", headers, body: Buffer.concat(chunks) }));
      res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      res.end(await response.text());
      return;
    }
    if (req.url === "/bundle.js") { res.setHeader("Content-Type", "application/javascript"); res.end(browserBundle.outputFiles[0].contents); return; }
    res.setHeader("Content-Type", "text/html");
    res.end(`<!doctype html><html><head><style>${css}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>`);
  })().catch(() => { res.writeHead(500).end("Test handler failed"); }); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test address");
  origin = `http://127.0.0.1:${address.port}`;
});
test.beforeEach(() => { api.calls.length = 0; api.failStatus = 0; api.delay = 0; });
test.afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });

test("submits restored comment once, keeps other drafts, and returns to its block", async ({ page }, info) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(origin);
  const comment = page.getByRole("textbox", { name: "New discussion comment" });
  await page.getByRole("button", { name: "Add comment on Cell 2 code", exact: true }).click();
  await comment.fill("Does this use all observations?");
  await page.getByRole("button", { name: "Add comment on Cell 2 outputs", exact: true }).click();
  await comment.fill("Unsubmitted output draft");
  await page.getByRole("button", { name: "Add comment on Cell 2 code", exact: true }).click();
  await expect(comment).toHaveValue("Does this use all observations?");
  api.delay = 250;
  await page.getByRole("button", { name: "Comment", exact: true }).click();
  await expect(page.getByRole("button", { name: "Comment", exact: true })).toBeDisabled();
  await expect(page.getByRole("status")).toHaveText("Posting…");
  await expect(page.getByRole("status")).toHaveText("Thread created.");
  await expect(comment).toHaveValue("");
  expect(api.calls).toHaveLength(1);
  expect(api.calls[0].path).toMatch(/^\/api\/reviews\/.*\/threads$/);
  expect(api.calls[0].body?.body_markdown).toBe("Does this use all observations?");
  expect(page.url()).toContain(origin + "/reviews/example/notebooks/pulls/7#");
  expect(new URL(page.url()).searchParams.has("flash")).toBe(false);
  expect(new URL(page.url()).searchParams.has("message")).toBe(false);
  expect(new URL(page.url()).hash).toMatch(/^#block-/);
  await page.getByRole("button", { name: "Add comment on Cell 2 outputs", exact: true }).click();
  await expect(comment).toHaveValue("Unsubmitted output draft");
  await page.getByRole("button", { name: "Add comment on Cell 2 code", exact: true }).click();
  await expect(comment).toHaveValue("");
  await page.screenshot({ path: info.outputPath("comment-submitted.png"), fullPage: true });
});

test("failed create stays inline with draft and supports a deliberate retry", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(origin);
  await page.getByRole("button", { name: "Add comment on Cell 2 code", exact: true }).click();
  const comment = page.getByRole("textbox", { name: "New discussion comment" });
  await comment.fill("Keep this question after a service failure");
  api.failStatus = 503;
  await page.getByRole("button", { name: "Comment", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Synthetic service failure.");
  await expect(comment).toHaveValue("Keep this question after a service failure");
  expect(page.url()).toBe(origin + "/");
  expect(api.calls).toHaveLength(1);
  await page.screenshot({ path: info.outputPath("comment-failed-draft-retained.png"), fullPage: true });
  api.failStatus = 0;
  await page.getByRole("button", { name: "Comment", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Thread created.");
  expect(api.calls).toHaveLength(2);
});

test("expired sign-in retains comment text and offers a local login in a new tab", async ({ page }) => {
  await page.goto(origin);
  await page.getByRole("button", { name: "Add comment on Cell 2 code", exact: true }).click();
  await page.getByRole("textbox", { name: "New discussion comment" }).fill("Keep my draft while I sign in");
  api.failStatus = 401;
  await page.getByRole("button", { name: "Comment", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Sign in required.");
  const login = page.getByRole("link", { name: "Sign in again in a new tab, then retry here" });
  await expect(login).toHaveAttribute("href", /^\/api\/auth\/github\/login\?/);
  await expect(login).toHaveAttribute("target", "_blank");
  await expect(page.getByRole("textbox", { name: "New discussion comment" })).toHaveValue("Keep my draft while I sign in");
});

test("reply and resolve use the actual action routes without clearing another composer", async ({ page }) => {
  await page.goto(origin);
  await page.getByRole("button", { name: "Add comment on Cell 2 code", exact: true }).click();
  await page.getByRole("textbox", { name: "New discussion comment" }).fill("Unsubmitted source question");
  await page.locator('[data-review-changes] .reply-details summary').click();
  const reply = page.getByRole("textbox", { name: /^Reply to/ });
  await reply.fill("Reply draft");
  api.failStatus = 403;
  await page.getByRole("button", { name: "Add reply", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(reply).toHaveValue("Reply draft");
  api.failStatus = 0;
  await page.getByRole("button", { name: "Add reply", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Reply added.");
  await expect(reply).toHaveValue("");
  await reply.fill("Another unfinished reply");
  await page.getByRole("button", { name: "Resolve", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Thread resolved." })).toBeVisible();
  await expect(reply).toHaveValue("Another unfinished reply");
  await expect(page.getByRole("textbox", { name: "New discussion comment" })).toHaveValue("Unsubmitted source question");
  expect(api.calls.map(call => call.path)).toEqual(["/api/threads/thread-id/messages", "/api/threads/thread-id/messages", "/api/threads/thread-id/resolve"]);
});
