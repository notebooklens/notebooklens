import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

let server: Server;
let origin: string;
test.beforeAll(async () => {
  const result = await build({ entryPoints: [path.join(__dirname, "repository-picker-harness.tsx")], bundle: true, write: false, outdir: "test-bundle", platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' } });
  const script = result.outputFiles.find(file => file.path.endsWith(".js"))!;
  const moduleCss = result.outputFiles.find(file => file.path.endsWith(".css"))!;
  const globals = await readFile(path.join(__dirname, "../app/globals.css"), "utf8");
  server = createServer((req, res) => {
    if (req.url === "/bundle.js") { res.setHeader("Content-Type", "application/javascript"); res.end(script.contents); return; }
    res.setHeader("Content-Type", "text/html");
    res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${globals}\n${moduleCss.text}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>`);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test server address");
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });

for (const [width, height] of [[1440, 900], [1280, 800], [390, 844]]) {
  test(`repository selection and empty states at ${width}px`, async ({ page, browserName }, info) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.setViewportSize({ width, height });
    await page.goto(origin);
    const filter = page.getByRole("searchbox", { name: "Filter loaded repositories" });
    await expect(page.getByRole("heading", { name: "Select a repository" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Repository reviews" })).toHaveCSS("border-radius", "6px");
    await expect(page.getByRole("heading", { name: "NotebookLens", exact: true })).toHaveCSS("font-size", "20px");
    await page.keyboard.press("Tab");
    await expect(filter).toBeFocused();
    await expect(filter).toHaveCSS("outline-style", "solid");
    await page.screenshot({ path: info.outputPath(`repositories-${width}.png`), fullPage: true });
    await filter.fill(" FORECAST ");
    await expect(page.getByRole("button")).toHaveCount(2);
    await filter.fill("example/forecast");
    // WebKit's macOS default skips native buttons with Tab; Option+Tab includes them.
    await page.keyboard.press(browserName === "webkit" ? "Alt+Tab" : "Tab");
    await expect(page.getByRole("button", { name: "example/forecast 1 recent review" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "example/forecast" })).toBeVisible();
    const review = page.getByRole("link", { name: "Pull request #12" });
    await expect(review).toHaveAttribute("href", "/reviews/example/forecast/pulls/12/snapshots/1");
    await page.screenshot({ path: info.outputPath(`reviews-${width}.png`), fullPage: true });
    await page.getByRole("button", { name: "Repositories" }).click();
    await expect(filter).toHaveValue("example/forecast");
    await filter.fill("no-such-repository");
    await expect(page.getByRole("status")).toHaveText("No loaded repositories match this filter.");
    await filter.fill("example/empty");
    await page.getByRole("button", { name: "example/empty No reviews yet" }).click();
    await expect(page.getByRole("status")).toContainText("No notebook reviews are available");
    await page.getByRole("button", { name: "Repositories" }).click();
    await expect(page.getByRole("link", { name: "Next repositories" })).toHaveAttribute("href", "/?cursor=synthetic%20cursor%2F%2B%3F");
    await filter.fill("");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.goto(origin + "?empty");
    await expect(page.getByRole("status")).toHaveText("No accessible repositories on this page.");
    await expect(page.getByRole("link", { name: "Next repositories" })).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
