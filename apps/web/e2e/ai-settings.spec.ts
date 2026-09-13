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

test("AI settings preserve save/test boundaries and accessible pending/error feedback", async ({ page }, info) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  const outbound: string[] = []; page.on("request", (request) => { if (!request.url().startsWith(origin)) outbound.push(new URL(request.url()).origin); });
  await page.setViewportSize({ width: 1440, height: 900 }); await page.goto(origin);
  await expect(page.getByRole("heading", { name: "AI review settings" })).toBeVisible();
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
    await page.keyboard.press("Tab"); await expect(page.getByRole("link", { name: "Skip to gateway settings" })).toBeFocused();
    await page.getByLabel("Model name", { exact: true }).focus(); await expect(page.getByLabel("Model name", { exact: true })).toHaveCSS("outline-style", "solid");
    await page.screenshot({ path: info.outputPath(`ai-settings-${width}.png`), fullPage: true });
  }
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" }); await page.goto(origin);
  await expect(page.getByLabel("Model name", { exact: true })).toHaveCSS("background-color", "rgb(13, 17, 23)");
  await page.screenshot({ path: info.outputPath("ai-settings-dark.png"), fullPage: true });
  await page.emulateMedia({ colorScheme: "light" }); await page.goto(origin);
  await page.locator("details > summary").click();
  await page.getByLabel("GitHub API base URL", { exact: true }).fill("");
  await page.locator("details > summary").click();
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await expect(page.locator("details")).toHaveAttribute("open", "");
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
