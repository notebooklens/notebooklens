import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

let server: Server;
let origin: string;
const mockAction = `
export async function submitAiGatewaySettingsAction(previous, data) {
  const intent = data.get('intent');
  window.__aiAuditIntents = [...(window.__aiAuditIntents || []), intent];
  const result = await new Promise(resolve => { window.__finishAiRequest = resolve; });
  const form = { ...previous.form, display_name: data.get('displayName'), model_name: data.get('modelName'), base_url: data.get('baseUrl'), api_key: data.get('apiKey'), active: data.get('active') === 'on' };
  if(result === 'error') return {...previous, form, notice: {tone: 'error', message: 'Synthetic gateway request failed. Your entries are preserved.'}};
  if(intent === 'test') return {...previous, form, tested_endpoint: 'chat/completions', notice: {tone: 'success', message: 'Synthetic connection test succeeded. Settings were not saved.'}};
  return {...previous, form: {...form, api_key: ''}, config: {...previous.config, active: form.active, model_name: form.model_name, updated_at: '2026-09-13T01:00:00Z'}, notice: {tone: 'success', message: 'Synthetic settings saved.'}};
}`;
test.beforeAll(async () => {
  const bundle = await build({ entryPoints: [path.join(__dirname, "ai-settings-harness.tsx")], outdir: "ai-test-build", bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' }, plugins: [{ name: "isolated-ai-settings", setup(builder) {
    builder.onResolve({ filter: /^@\/lib\/actions$/ }, () => ({ path: "action", namespace: "ai-mock" }));
    builder.onResolve({ filter: /^(next\/navigation|@\/lib\/api|@\/components\/review-workspace)$/ }, () => ({ path: "route-dependencies", namespace: "recovery-mock" }));
    builder.onLoad({ filter: /.*/, namespace: "recovery-mock" }, () => ({ contents: "export class ApiRequestError extends Error {} export const notFound=()=>{}; export const buildLoginHref=()=>''; export const getReviewWorkspace=()=>{}; export const getSnapshotWorkspace=()=>{}; export const ReviewWorkspace=()=>null;", loader: "js" }));
    builder.onLoad({ filter: /.*/, namespace: "ai-mock" }, () => ({ contents: mockAction, loader: "js" }));
    builder.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "ai-next" }));
    builder.onLoad({ filter: /.*/, namespace: "ai-next" }, () => ({ contents: "import React from 'react'; export default function Link({children,...props}){return React.createElement('a',props,children)}", loader: "js", resolveDir: path.join(__dirname, "..") }));
  } }] });
  const script = bundle.outputFiles.find((file) => file.path.endsWith(".js"))!.contents;
  const css = (await readFile(path.join(__dirname, "../app/globals.css"), "utf8")) + bundle.outputFiles.find((file) => file.path.endsWith(".css"))!.text;
  server = createServer((req, res) => {
    if (req.url === "/bundle.js") { res.setHeader("Content-Type", "application/javascript"); res.end(script); return; }
    res.setHeader("Content-Type", "text/html");
    res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("No test server address");
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); });

test("review recovery keeps context visible and shares AI header geometry", async ({ page }, info) => {
  for (const width of [1920, 1440, 1280, 700, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await page.goto(`${origin}?review-recovery`);
      await expect(page.getByText("example/research · PR #7 · Push 3", { exact: true })).toBeVisible();
      const reviewBox = await page.locator(".workspace-topbar").boundingBox();
      await page.screenshot({ path: info.outputPath(`review-recovery-${width}-${colorScheme}.png`), fullPage: true });
      await page.goto(`${origin}?recovery=forbidden`);
      const aiBox = await page.locator(".workspace-topbar").boundingBox();
      expect(aiBox!.x).toBeCloseTo(reviewBox!.x, 0);
      expect(aiBox!.width).toBeCloseTo(reviewBox!.width, 0);
      await expect(page.getByRole("link", { name: "Home", exact: true })).toHaveCSS("font-size", "14px");
      await expect(page.locator(".workspace-topbar")).toHaveCSS("background-color", colorScheme === "dark" ? "rgb(22, 27, 34)" : "rgb(246, 248, 250)");
      const settings = page.locator(".workspace-topbar summary");
      await settings.click();
      await expect(page.getByRole("button", { name: "Sign out", exact: true })).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Open team AI settings" })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(settings).toBeFocused();
      await page.screenshot({ path: info.outputPath(`ai-recovery-${width}-${colorScheme}.png`), fullPage: true });
    }
  }
});

test("AI settings recovery shares the compact shell, keyboard navigation and honest access states", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  for (const [width, height] of [[1440, 900], [1280, 800], [390, 844], [320, 800]]) {
    await page.setViewportSize({ width, height });
    for (const kind of ["unauthenticated", "forbidden", "not-found", "unavailable"]) {
      await page.goto(`${origin}?recovery=${kind}`);
      await expect(page.getByRole("heading", { name: "AI review settings", exact: true })).toHaveCSS("font-size", "20px");
      const home = page.getByRole("link", { name: "Home", exact: true });
      await expect(home).toBeVisible();
      await expect(home).toHaveAttribute("href", "/");
      await expect(home).toHaveCSS("font-size", "14px");
      await expect(page.locator(".workspace-brand")).toHaveText("NotebookLens");
      await expect(page.getByRole("link", { name: "Back to review" })).toHaveAttribute("href", "/reviews/example/research/pulls/7");
      await expect(page.getByRole("main")).toBeVisible();
      await expect(page.getByRole("button", { name: "Save settings" })).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.keyboard.press("Tab");
      await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("main")).toBeFocused();
      if (kind === "forbidden") {
        await expect(page.getByText(/Repository write access alone is not enough/)).toBeVisible();
        await expect(page.getByRole("link", { name: "Check GitHub access again" })).toHaveAttribute("href", "/api/auth/github/login?next_path=%2Fsettings");
        await page.screenshot({ path: info.outputPath(`ai-forbidden-${width}.png`), fullPage: true });
      }
      if (kind === "unavailable") await expect(page.getByRole("link", { name: "Try again" })).toHaveAttribute("href", "/settings");
    }
  }
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.goto(`${origin}?recovery=forbidden`);
  await expect(page.locator("main > section")).toHaveCSS("background-color", "rgb(13, 17, 23)");
  await page.screenshot({ path: info.outputPath("ai-forbidden-dark.png"), fullPage: true });
  expect(errors).toEqual([]);
});

test("AI settings preserve save/test boundaries and accessible pending/error feedback", async ({ page }, info) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  const outbound: string[] = []; page.on("request", (request) => { if (!request.url().startsWith(origin)) outbound.push(new URL(request.url()).origin); });
  await page.setViewportSize({ width: 1440, height: 900 }); await page.goto(origin);
  await expect(page.getByRole("heading", { name: "AI review settings" })).toBeVisible();
  await page.locator(".workspace-topbar summary").click();
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
  await expect(page.locator('form[action="/actions/auth/logout"] input[name="returnTo"]')).toHaveValue("/reviews/example/research/pulls/7/ai");
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("API key", { exact: true })).toHaveValue("");
  await page.getByLabel("Model name", { exact: true }).fill("new-model");
  await page.getByLabel("Enable the gateway for this installation", { exact: true }).check();
  await page.getByRole("button", { name: "Test connection", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Testing the gateway" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Testing…", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save settings", exact: true })).toBeDisabled();
  await expect(page.getByLabel("Model name", { exact: true })).toBeDisabled();
  await page.screenshot({ path: info.outputPath("ai-pending.png"), fullPage: true });
  await page.evaluate(() => (window as unknown as { __finishAiRequest: (value: string) => void }).__finishAiRequest("success"));
  await expect(page.getByRole("status").filter({ hasText: "Synthetic connection test succeeded" })).toBeVisible();
  await expect(page.getByText(/Saved state: disabled/)).toBeVisible();
  await expect(page.getByLabel("Model name", { exact: true })).toHaveValue("new-model");
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await expect(page.getByRole("button", { name: "Saving…", exact: true })).toBeDisabled();
  await page.evaluate(() => (window as unknown as { __finishAiRequest: (value: string) => void }).__finishAiRequest("error"));
  await expect(page.getByRole("alert")).toContainText("Your entries are preserved");
  await expect(page.getByLabel("Model name", { exact: true })).toHaveValue("new-model");
  await page.screenshot({ path: info.outputPath("ai-error.png"), fullPage: true });
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await page.evaluate(() => (window as unknown as { __finishAiRequest: (value: string) => void }).__finishAiRequest("success"));
  await expect(page.getByText(/Saved state: enabled/)).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __aiAuditIntents: string[] }).__aiAuditIntents)).toEqual(["test", "save", "save"]);
  await page.screenshot({ path: info.outputPath("ai-success.png"), fullPage: true });
  expect(errors).toEqual([]); expect(outbound).toEqual([]);
});

test("AI settings use shared compact tokens, keyboard access and narrow reflow", async ({ page }, info) => {
  for (const [width, height] of [[1440, 900], [1280, 800], [390, 844], [320, 800]]) {
    await page.setViewportSize({ width, height }); await page.goto(origin);
    const heading = page.getByRole("heading", { name: "AI review settings" }); await expect(heading).toHaveCSS("font-size", "20px"); await expect(heading).toHaveCSS("font-weight", "600");
    await expect(page.getByLabel("Model name", { exact: true })).toHaveCSS("border-radius", "6px");
    await expect(page.getByRole("button", { name: "Save settings", exact: true })).toHaveCSS("border-radius", "6px");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.keyboard.press("Tab"); await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused();
    await page.getByLabel("Model name", { exact: true }).focus(); await expect(page.getByLabel("Model name", { exact: true })).toHaveCSS("outline-style", "solid");
    await page.screenshot({ path: info.outputPath(`ai-settings-${width}.png`), fullPage: true });
  }
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" }); await page.goto(origin);
  await expect(page.getByLabel("Model name", { exact: true })).toHaveCSS("background-color", "rgb(13, 17, 23)");
  await page.screenshot({ path: info.outputPath("ai-settings-dark.png"), fullPage: true });
  await page.emulateMedia({ colorScheme: "light" }); await page.goto(origin);
  await page.locator("main details > summary").click();
  await page.getByLabel("GitHub API base URL", { exact: true }).fill("");
  await page.locator("main details > summary").click();
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await expect(page.locator("main details")).toHaveAttribute("open", "");
  await expect(page.getByLabel("GitHub API base URL", { exact: true })).toBeFocused();
  expect(await page.evaluate(() => (window as unknown as { __aiAuditIntents?: string[] }).__aiAuditIntents ?? [])).toEqual([]);
  await page.goto(origin);
  // CSS zoom is a reflow smoke test, not a claim of full browser/text-zoom conformance.
  await page.locator("body").evaluate((node) => { (node as HTMLElement).style.zoom = "2"; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.emulateMedia({ colorScheme: "light" }); await page.goto(`${origin}?empty`);
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await expect(page.getByLabel("Model name", { exact: true })).toBeFocused();
  expect(await page.evaluate(() => (window as unknown as { __aiAuditIntents?: string[] }).__aiAuditIntents ?? [])).toEqual([]);
});
