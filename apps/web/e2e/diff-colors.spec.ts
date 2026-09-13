import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

let server: Server;
let origin: string;
test.beforeAll(async () => {
  const result = await build({ entryPoints: [path.join(__dirname, "workspace-harness.tsx")], bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' }, plugins: [{ name: "test-next-components", setup(builder) {
    // Synthetic navigation only: this harness does not fetch Next server-component data.
    builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "router", namespace: "test-router" }));
    builder.onLoad({ filter: /.*/, namespace: "test-router" }, () => ({ contents: "export function useRouter(){return {replace(path){history.replaceState(null,'',path)},refresh(){window.dispatchEvent(new Event('test-router-refresh'))}}}", loader: "js" }));
    builder.onResolve({ filter: /^next\/(image|link)$/ }, (args) => ({ path: args.path, namespace: "test-next" }));
    builder.onLoad({ filter: /.*/, namespace: "test-next" }, (args) => ({ contents: `import React from 'react'; export default function Component({children, ...props}) { return React.createElement('${args.path.endsWith("image") ? "img" : "a"}', props, children); }`, loader: "js", resolveDir: path.join(__dirname, "..") }));
  } }] });
  const css = await readFile(path.join(__dirname, "../app/globals.css"), "utf8");
  server = createServer((req, res) => {
    if (req.url === "/bundle.js") { res.setHeader("Content-Type", "application/javascript"); res.end(result.outputFiles[0].contents); return; }
    res.setHeader("Content-Type", "text/html");
    res.end(`<!doctype html><html><head><style>${css}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test server address");
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); });


test("GitHub-style addition and deletion colors keep signs and neutral gaps", async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(origin);
  await expect(page.locator(".notebook-card")).toHaveCSS("border-radius", "6px");
  await expect(page.locator(".code-pane").first()).toHaveCSS("border-radius", "4px");
  await expect(page.locator(".workspace-title")).toHaveCSS("font-size", "20px");
  await expect(page.locator(".workspace-title")).toHaveCSS("font-weight", "600");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(246, 248, 250)");
  for (const selector of [".snapshot-controls .workspace-menu > summary", ".review-toolbar .workspace-menu > summary", ".workspace-topbar .workspace-menu > summary"]) {
    await expect(page.locator(selector).first()).toHaveCSS("border-radius", "6px");
    await expect(page.locator(selector).first()).toHaveCSS("background-color", "rgb(246, 248, 250)");
  }
  const added = page.locator(".code-diff-line-added").first();
  const removed = page.locator(".code-diff-line-removed").first();
  await expect(added).toHaveCSS("background-color", "rgb(230, 255, 236)");
  await expect(removed).toHaveCSS("background-color", "rgb(255, 235, 233)");
  await expect(added).toHaveCSS("color", "rgb(31, 35, 40)");
  await expect(removed).toHaveCSS("color", "rgb(31, 35, 40)");
  await expect(added.locator(".code-diff-line-marker")).toHaveCSS("color", "rgb(26, 127, 55)");
  await expect(removed.locator(".code-diff-line-marker")).toHaveCSS("color", "rgb(207, 34, 46)");
  await expect(added.locator(".code-diff-line-marker")).toHaveText("+");
  await expect(removed.locator(".code-diff-line-marker")).toHaveText("−");
  await expect(added.locator(".code-diff-line-number")).toHaveCSS("background-color", "rgb(204, 255, 216)");
  await expect(removed.locator(".code-diff-line-number")).toHaveCSS("background-color", "rgb(255, 215, 213)");
  await expect(page.locator(".code-diff-line-placeholder").first()).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(page.locator(".code-diff-line-unchanged").first()).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await page.locator(".notebook-card").screenshot({ path: info.outputPath("github-style-diff.png") });
  await page.goto(origin + "?added");
  await expect(page.locator(".code-diff-line-added")).toHaveCount(4);
  await expect(page.locator(".code-diff-line-added").first()).toHaveCSS("background-color", "rgb(230, 255, 236)");
  await expect(page.locator(".code-diff-line-added .code-diff-line-marker").first()).toHaveText("+");
});

test("whole-cell and notebook additions/deletions have matching source and badge colors", async ({ page }, info) => {
  for (const [kind, cssKind, background, marker] of [["added", "success", "rgb(230, 255, 236)", "+"], ["deleted", "danger", "rgb(255, 235, 233)", "−"]]) {
    await page.goto(`${origin}?${kind}`);
    await expect(page.locator(`.notebook-head .tone-${cssKind}`)).toHaveCSS("background-color", background);
    await expect(page.locator(`.cell-card-meta .tone-${cssKind}`)).toHaveCSS("background-color", background);
    await expect(page.locator(`.output-meta .tone-${cssKind}`).first()).toHaveCSS("background-color", background);
    await expect(page.locator(".code-diff-line-marker").first()).toHaveText(marker);
    await page.screenshot({ path: info.outputPath(`whole-code-${kind}.png`), fullPage: true });
    await page.goto(`${origin}?${kind}&markdown`);
    await expect(page.locator(".markdown-pane")).toHaveCSS("background-color", background);
    await expect(page.locator(".markdown-change-marker")).toHaveText(marker);
    await expect(page.getByText(kind === "added" ? "Added cell" : "Removed cell", { exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath(`whole-markdown-${kind}.png`), fullPage: true });
  }
});
