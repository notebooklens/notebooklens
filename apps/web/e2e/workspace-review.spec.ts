import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

let server: Server;
let origin: string;
test.beforeAll(async () => {
  const result = await build({ entryPoints: [path.join(__dirname, "workspace-harness.tsx")], bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' }, plugins: [{ name: "test-next-components", setup(builder) {
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

test("modified notebook aligns changes and keeps discussions contextual", async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(origin);
  await expect(page.getByText("Before", { exact: true }).first()).toBeVisible();
  await expect(page.locator(".code-diff-line-placeholder")).toHaveCount(1);
  const panes = page.locator(".aligned-code-grid .code-pane");
  const left = await panes.nth(0).boundingBox();
  const right = await panes.nth(1).boundingBox();
  expect(left!.y).toBe(right!.y);
  expect(right!.x).toBeGreaterThan(left!.x);
  await expect(page.locator(".metadata-disclosure")).not.toHaveAttribute("open");
  const metadataId = await page.locator(".metadata-disclosure section").getAttribute("id");
  await page.evaluate((id) => { window.location.hash = id!; }, metadataId);
  await expect(page.locator(".metadata-disclosure")).toHaveAttribute("open", "");
  await expect(page.locator("[data-review-changes] .thread-details")).toHaveAttribute("open", "");
  await page.getByRole("button", { name: "Add comment on Cell 2 code", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "New discussion comment" })).toBeFocused();
  await page.getByRole("textbox", { name: "New discussion comment" }).fill("Does this mean include all observations?");
  await page.screenshot({ path: info.outputPath("modified-notebook.png"), fullPage: true });
  await page.getByRole("button", { name: "Discussions (1)", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Discussions on this push" })).toBeVisible();
  await page.locator(".discussion-index").getByText("Reply", { exact: true }).click();
  await expect(page.getByRole("textbox", { name: /^Reply to/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Resolve", exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: /^Reply to/ }).fill("Reply draft");
  await page.getByRole("button", { name: "Changes", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "New discussion comment" })).toHaveValue("Does this mean include all observations?");
  await page.frameLocator("iframe.html-output-frame").getByLabel("Saved note").fill("Retained frame state");
  await page.getByRole("button", { name: "Discussions (1)", exact: true }).click();
  await expect(page.getByRole("textbox", { name: /^Reply to/ })).toHaveValue("Reply draft");
  await page.getByRole("button", { name: "Changes", exact: true }).click();
  await expect(page.frameLocator("iframe.html-output-frame").getByLabel("Saved note")).toHaveValue("Retained frame state");
  await page.getByLabel("Show previous version", { exact: true }).uncheck();
  await expect(page.locator(".code-diff-line-added")).not.toHaveCount(0);
  await expect(page.frameLocator("iframe.html-output-frame").getByLabel("Saved note")).toHaveValue("Retained frame state");
});

test("same-hash navigation reopens ancestors and empty before source keeps aligned rows", async ({ page }) => {
  await page.goto(`${origin}?empty`);
  await expect(page.locator(".aligned-code-grid .code-pane").first().locator(".code-diff-line-placeholder")).toHaveCount(2);
  const target = await page.locator(".metadata-disclosure section").getAttribute("id");
  await page.evaluate((id) => { window.location.hash = id!; }, target);
  await page.locator(".metadata-disclosure > summary").click();
  await expect(page.locator(".metadata-disclosure")).not.toHaveAttribute("open");
  await page.evaluate((id) => {
    const link = document.createElement("a"); link.href = `#${id}`; link.textContent = "Return to metadata";
    document.querySelector(".review-toolbar")!.appendChild(link);
  }, target);
  await page.getByRole("link", { name: "Return to metadata" }).click();
  await expect(page.locator(".metadata-disclosure")).toHaveAttribute("open", "");
  const ids = await page.locator("[id]").evaluateAll((elements) => elements.map((element) => element.id));
  expect(new Set(ids).size).toBe(ids.length);
  await page.goto(`${origin}#index-thread-thread-id`);
  await expect(page.getByRole("heading", { name: "Discussions on this push" })).toBeVisible();
});

test("added cells show one neutral source version", async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(`${origin}?added`);
  await expect(page.locator(".aligned-code-grid")).toHaveCount(0);
  await expect(page.locator(".code-diff-line-added")).toHaveCount(0);
  await expect(page.getByText("Added cell", { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("added-notebook.png"), fullPage: true });
  await page.getByLabel("Show outputs", { exact: true }).uncheck();
  await expect(page.getByText(/Outputs hidden/)).toBeVisible();
});
