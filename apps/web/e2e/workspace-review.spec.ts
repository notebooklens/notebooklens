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

for (const width of [1440, 1280, 390]) {
  test(`header navigation and push controls stay usable at ${width}px`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${origin}?history`);
    const topbar = page.getByRole("navigation", { name: "Workspace navigation" });
    await expect(topbar.getByRole("link", { name: "Home", exact: true })).toHaveAttribute("href", "/");
    await expect(topbar.getByRole("link", { name: "NotebookLens", exact: true })).toHaveAttribute("href", "/");
    await expect(page.locator(".workspace-sidebar, .workspace-utility-card")).toHaveCount(0);
    const settings = topbar.locator("summary");
    await settings.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("link", { name: "Open team AI settings" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath(`settings-${width}.png`) });
    await page.keyboard.press("Escape");
    await expect(settings).toBeFocused();
    await expect(page.getByRole("link", { name: "Open team AI settings" })).toBeHidden();
    const controls = page.locator(".snapshot-controls");
    const details = controls.locator("summary").filter({ hasText: "Push details" });
    const history = controls.locator("summary").filter({ hasText: "Switch push" });
    expect((await details.boundingBox())!.y).toBe((await history.boundingBox())!.y);
    await history.click();
    const historyNav = page.getByRole("navigation", { name: "Push history" });
    await expect(historyNav.getByRole("link", { name: /^Push 1/ })).toHaveAttribute("aria-current", "page");
    await expect(historyNav.getByRole("link", { name: /^Latest push/ })).toHaveAttribute("href", "/reviews/octo-org/notebooklens/pulls/7");
    await historyNav.getByRole("link", { name: /^Latest push/ }).click({ trial: true });
    await page.screenshot({ path: info.outputPath(`pushes-${width}.png`) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await details.click();
    await expect(historyNav).toBeHidden();
    await expect(page.getByText("Compared against", { exact: true })).toBeVisible();
    await page.getByRole("heading", { level: 1 }).click();
    await expect(page.getByText("Compared against", { exact: true })).toBeHidden();
    await page.getByRole("button", { name: "Add comment on Cell 2 code", exact: true }).click();
    await page.getByRole("textbox", { name: "New discussion comment" }).fill("Keep this draft while navigating");
    await page.getByRole("button", { name: "Discussions (1)", exact: true }).click();
    await expect(history).toBeVisible();
    const navigate = page.locator(".review-toolbar summary");
    await navigate.click();
    await page.getByRole("button", { name: /Next changed output/ }).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-review-changes]")).toBeVisible();
    await expect(page.getByRole("textbox", { name: "New discussion comment" })).toHaveValue("Keep this draft while navigating");
    await expect(page.locator(".review-toolbar .workspace-menu")).not.toHaveAttribute("open");
    await expect(page.locator(".diff-block:focus")).toBeVisible();
    const focusedTarget = (await page.locator(".diff-block:focus").boundingBox())!;
    const headerBox = (await topbar.boundingBox())!;
    expect(focusedTarget.y).toBeGreaterThanOrEqual(headerBox.y + headerBox.height);
    await page.screenshot({ path: info.outputPath(`navigation-${width}.png`), fullPage: true });
    await topbar.getByRole("link", { name: "Home", exact: true }).click();
    await expect(page).toHaveURL(`${origin}/`);
    expect(errors).toEqual([]);
  });
}

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
  await expect(page.locator(".metadata-disclosure")).toHaveCount(0);
  await expect(page.locator("[data-review-changes] .thread-details")).toHaveAttribute("open", "");
  await page.getByRole("button", { name: "Add comment on Cell 2 code", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "New discussion comment" })).toBeFocused();
  await page.getByRole("textbox", { name: "New discussion comment" }).fill("Does this mean include all observations?");
  await page.getByRole("button", { name: "Add comment on Cell 2 outputs", exact: true }).click();
  await page.getByRole("textbox", { name: "New discussion comment" }).fill("Output draft");
  await page.getByRole("button", { name: "Add comment on Cell 2 code", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "New discussion comment" })).toHaveValue("Does this mean include all observations?");
  await page.screenshot({ path: info.outputPath("modified-notebook.png"), fullPage: true });
  await page.getByRole("button", { name: "Discussions (1)", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Discussions on this push" })).toBeVisible();
  await expect(page.getByRole("main")).toHaveCount(1);
  await page.locator(".discussion-index").getByText("Reply", { exact: true }).click();
  await expect(page.getByRole("textbox", { name: /^Reply to/ })).toBeVisible();
  expect((await page.getByRole("textbox", { name: /^Reply to/ }).boundingBox())!.width).toBeGreaterThan(500);
  await expect(page.getByRole("button", { name: "Resolve", exact: true })).toBeVisible();
  const replyBox = (await page.locator(".discussion-index .reply-details").boundingBox())!;
  const resolveBox = (await page.getByRole("button", { name: "Resolve", exact: true }).boundingBox())!;
  expect(resolveBox.x).toBeGreaterThan(replyBox.x + replyBox.width);
  expect(Math.abs(resolveBox.y - replyBox.y)).toBeLessThan(16);
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
  const target = await page.locator(".notebook-card").getAttribute("id");
  await page.evaluate((id) => { window.location.hash = id!; }, target);
  await page.locator(".notebook-card > summary").click();
  await expect(page.locator(".notebook-card")).not.toHaveAttribute("open");
  await page.evaluate((id) => {
    const link = document.createElement("a"); link.href = `#${id}`; link.textContent = "Return to notebook";
    document.querySelector(".review-toolbar")!.appendChild(link);
  }, target);
  await page.getByRole("link", { name: "Return to notebook" }).click();
  await expect(page.locator(".notebook-card")).toHaveAttribute("open", "");
  const ids = await page.locator("[id]").evaluateAll((elements) => elements.map((element) => element.id));
  expect(new Set(ids).size).toBe(ids.length);
  await page.goto(`${origin}#index-thread-thread-id`);
  await expect(page.getByRole("heading", { name: "Discussions on this push" })).toBeVisible();
});

test("added cells show one green source version with plus markers", async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(`${origin}?added`);
  await expect(page.locator(".aligned-code-grid")).toHaveCount(0);
  await expect(page.locator(".code-diff-line-added")).toHaveCount(4);
  await expect(page.locator(".code-diff-line-added").first()).toHaveCSS("background-color", "rgb(230, 255, 236)");
  await expect(page.locator(".code-diff-line-marker").first()).toHaveText("+");
  await expect(page.getByText("Added cell", { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("added-notebook.png"), fullPage: true });
  await page.getByLabel("Show outputs", { exact: true }).uncheck();
  await expect(page.getByText(/Outputs hidden/)).toBeVisible();
});

test("metadata is absent from Changes but existing metadata discussions remain usable", async ({ page }) => {
  await page.goto(origin + "?metadata-only");
  await expect(page.getByRole("heading", { name: "No code or output changes on this push" })).toBeVisible();
  await expect(page.locator(".cell-card, .metadata-disclosure")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Add comment on .*metadata/i })).toHaveCount(0);
  await expect(page.locator('[data-review-changes] a[href="#thread-thread-id"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Discussions (1)", exact: true }).click();
  await expect(page.getByText(/Cell 2 · Metadata/)).toBeVisible();
  await expect(page.locator(".discussion-index").getByText(/Anchor needs review/)).toHaveCount(0);
  await page.locator(".discussion-index").getByText("Reply", { exact: true }).click();
  await expect(page.getByRole("textbox", { name: /^Reply to/ })).toBeVisible();
});

test("moved-only cells remain visible without fake source edits", async ({ page }) => {
  await page.goto(origin + "?moved");
  await expect(page.locator(".cell-card")).toHaveCount(1);
  await expect(page.getByText("Cell 1 → 2", { exact: true })).toBeVisible();
  await expect(page.locator(".code-diff-line-added, .code-diff-line-removed")).toHaveCount(0);
  await expect(page.locator(".code-diff-line-content").first()).toHaveText("value = 1");
});

test("deleted cells retain their original source and output with previous version hidden", async ({ page }) => {
  await page.goto(origin + "?deleted");
  await expect(page.getByText("Removed cell", { exact: true })).toBeVisible();
  await expect(page.locator(".code-diff-line-content")).toHaveText("retired_metric = 15");
  await expect(page.locator(".code-diff-line-removed")).toHaveCSS("background-color", "rgb(255, 235, 233)");
  await expect(page.locator(".code-diff-line-marker")).toHaveText("−");
  await expect(page.getByText("Retired saved output", { exact: true })).toBeVisible();
  await expect(page.getByText("After", { exact: true })).toHaveCount(0);
  await page.getByLabel("Show previous version", { exact: true }).uncheck();
  await expect(page.getByText("Removed cell", { exact: true })).toBeVisible();
  await expect(page.locator(".code-diff-line-content")).toHaveText("retired_metric = 15");
  await expect(page.getByText("Retired saved output", { exact: true })).toBeVisible();
  await expect(page.getByText("After", { exact: true })).toHaveCount(0);
});

test("mobile source panes stack with usable width and reachable comment controls", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(origin);
  const panes = page.locator(".aligned-code-grid .code-pane");
  const before = (await panes.nth(0).boundingBox())!;
  const after = (await panes.nth(1).boundingBox())!;
  expect(before.width).toBeGreaterThan(270);
  expect(after.y).toBeGreaterThan(before.y);
  expect(after.x).toBe(before.x);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const comment = page.getByRole("button", { name: "Add comment on Cell 2 code", exact: true });
  await comment.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("textbox", { name: "New discussion comment" })).toBeFocused();
  await page.screenshot({ path: info.outputPath("mobile-notebook.png"), fullPage: true });
});
