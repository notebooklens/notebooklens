import { test } from "@playwright/test";
import { build } from "esbuild";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

test.skip(process.env.NOTEBOOKLENS_USABILITY_AUDIT !== "1", "Opt-in visual audit; requires local production service for anonymous checks.");
let server: Server;
let origin: string;
let bundleBytes = 0;
const artifacts = path.resolve(__dirname, "../../../DESIGN-IS-2026-09-13");
test.beforeAll(async () => {
  const result = await build({ entryPoints: [path.join(__dirname, "usability-audit-harness.tsx")], bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' }, plugins: [{ name: "audit-next-components", setup(builder) {
    builder.onResolve({ filter: /^next\/(image|link)$/ }, (args) => ({ path: args.path, namespace: "audit-next" }));
    builder.onLoad({ filter: /.*/, namespace: "audit-next" }, (args) => ({ contents: `import React from 'react'; export default function Component({children, ...props}) { return React.createElement('${args.path.endsWith("image") ? "img" : "a"}', props, children); }`, loader: "js", resolveDir: path.join(__dirname, "..") }));
  } }] });
  bundleBytes = result.outputFiles[0].contents.byteLength;
  const css = await readFile(path.join(__dirname, "../app/globals.css"), "utf8");
  server = createServer((req, res) => {
    if (req.url === "/bundle.js") { res.setHeader("Content-Type", "application/javascript"); res.end(result.outputFiles[0].contents); return; }
    res.setHeader("Content-Type", "text/html");
    res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test server address");
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); });

test("gather usability evidence without asserting that workflow is good", async ({ page }) => {
  test.setTimeout(120_000);
  for (const [width, height] of [[1440, 900], [1280, 800], [390, 844]]) {
    await page.setViewportSize({ width, height });
    await page.goto(origin);
    await page.locator(".review-toolbar").waitFor();
    await page.waitForTimeout(500); // Give srcdoc table outputs time to paint before recording evidence.
    await page.locator(".html-output-frame").first().scrollIntoViewIfNeeded();
    await page.frameLocator(".html-output-frame").first().locator("table").waitFor({ state: "visible" });
    if (width === 1440) await page.screenshot({ path: path.join(artifacts, "audit-output-comparison.png") });
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: path.join(artifacts, `audit-review-${width}.png`), fullPage: true });
    console.log("AUDIT_VIEW", JSON.stringify(await page.evaluate(() => {
      const selected = [".workspace-title", ".review-toolbar", ".cell-card", ".code-pane", ".code-diff-line-content", ".thread-affordance-button", ".metadata-disclosure", ".workspace-sidebar", ".thread-card"];
      return { viewport: { width: innerWidth, height: innerHeight }, document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }, notebooks: document.querySelectorAll(".notebook-card").length, cells: document.querySelectorAll(".cell-card").length, metrics: selected.map((selector) => {
        const node = document.querySelector(selector); if (!node) return { selector, absent: true };
        const style = getComputedStyle(node); const rect = node.getBoundingClientRect();
        return { selector, x: rect.x, y: rect.y, width: rect.width, height: rect.height, fontSize: style.fontSize, lineHeight: style.lineHeight, color: style.color, background: style.backgroundColor, padding: style.padding, gap: style.gap };
      }) };
    })));
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(origin);
  const create = page.getByRole("button", { name: "Add comment on Cell 2 code", exact: true });
  await create.click();
  const composer = page.getByRole("textbox", { name: "New discussion comment" });
  await composer.fill("Audit draft: why did the population change?");
  console.log("AUDIT_FOCUS", JSON.stringify(await composer.evaluate((node) => ({ focused: document.activeElement === node, outline: getComputedStyle(node).outline, body: (node as HTMLTextAreaElement).value }))));
  await page.screenshot({ path: path.join(artifacts, "audit-comment-focus.png"), fullPage: true });
  await page.getByRole("button", { name: "Add comment on Cell 3 outputs", exact: true }).click();
  console.log("AUDIT_OTHER_COMPOSER", JSON.stringify({ value: await composer.inputValue(), count: await composer.count() }));
  await create.click();
  console.log("AUDIT_RETURN_COMPOSER", JSON.stringify({ value: await composer.inputValue() }));
  await composer.fill("Audit second draft");
  await page.getByRole("button", { name: "Discussions (2)", exact: true }).click();
  const index = page.locator(".discussion-index");
  await index.getByText("Reply", { exact: true }).first().click();
  await index.getByRole("textbox").first().fill("Audit reply draft");
  console.log("AUDIT_REPLY_WIDTH", JSON.stringify(await index.getByRole("textbox").first().boundingBox()));
  await page.screenshot({ path: path.join(artifacts, "audit-discussions.png"), fullPage: true });
  await page.getByRole("button", { name: "Changes", exact: true }).click();
  console.log("AUDIT_TAB_DRAFT", JSON.stringify({ value: await composer.inputValue() }));
  await page.getByLabel("Show outputs", { exact: true }).uncheck();
  console.log("AUDIT_OUTPUT_TOGGLE", JSON.stringify({ notices: await page.getByText(/Outputs hidden/).count(), visibleThreads: await page.locator("[data-review-changes] .thread-card:visible").count() }));
  await page.getByLabel("Show outputs", { exact: true }).check();
  await page.locator(".review-navigation-disclosure > summary").click();
  console.log("AUDIT_NAVIGATION_START", JSON.stringify(await page.evaluate(() => ({ scrollY, navTop: document.querySelector(".review-navigation-disclosure")!.getBoundingClientRect().top + scrollY }))));
  await page.getByRole("button", { name: /Next unresolved thread/ }).click();
  console.log("AUDIT_NEXT_THREAD", JSON.stringify(await page.evaluate(() => ({ scrollY, hash: location.hash }))));
  for (const state of ["empty", "loading", "error", "success", "historical"]) {
    await page.goto(`${origin}?state=${state}`);
    await page.locator(".review-toolbar").waitFor();
    if (state === "empty") await page.locator(".review-navigation-disclosure > summary").click();
    await page.screenshot({ path: path.join(artifacts, `audit-state-${state}.png`), fullPage: true });
    console.log("AUDIT_STATE", JSON.stringify({ state, disabledButtons: await page.locator("button:disabled").count(), addCommentButtons: await page.getByRole("button", { name: /^Add comment on/ }).count(), headings: await page.getByRole("heading").allTextContents(), status: await page.locator("[role=status],[role=alert]").allTextContents() }));
  }
});

test("capture anonymous production entry without real user session", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const [label, target] of [["entry", "http://127.0.0.1:18080/"], ["review-wall", "http://127.0.0.1:18080/reviews/notebooklens/notebooklens/pulls/15/snapshots/1"]]) {
    const response = await page.goto(target);
    await page.screenshot({ path: path.join(artifacts, `audit-production-${label}.png`), fullPage: true });
    console.log("AUDIT_PRODUCTION", JSON.stringify({ label, status: response?.status(), path: new URL(page.url()).pathname, headings: await page.getByRole("heading").allTextContents(), buttons: await page.getByRole("button").allTextContents() }));
  }
});

test("measure structure contrast and navigation friction", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(origin);
  await page.locator(".review-toolbar").waitFor();
  await page.waitForTimeout(500); // A fixed observation point, not a time-to-interactive claim.
  console.log("AUDIT_WEIGHT", JSON.stringify({ bundleBytes, metrics: await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
    const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
    return { requests: resources.length + 1, resources: resources.map((r) => ({ name: new URL(r.name).pathname, transferSize: r.transferSize, encodedBodySize: r.encodedBodySize, duration: r.duration })), domContentLoadedMs: nav.domContentLoadedEventEnd, loadEventEndMs: nav.loadEventEnd, animationsAtObservation: document.getAnimations().length };
  }) }));
  console.log("AUDIT_STRUCTURE", JSON.stringify(await page.evaluate(() => {
    const visible = (node: Element) => {
      if (!node.getClientRects().length || getComputedStyle(node).visibility === "hidden") return false;
      for (let ancestor: Element | null = node.parentElement; ancestor; ancestor = ancestor.parentElement) {
        if (ancestor instanceof HTMLDetailsElement && !ancestor.open && !ancestor.querySelector(":scope > summary")?.contains(node)) return false;
      }
      return true;
    };
    const controls = Array.from(document.querySelectorAll('a[href],button,input:not([type="hidden"]),select,textarea,summary,[tabindex]')).filter((node) => !(node.hasAttribute("tabindex") && Number(node.getAttribute("tabindex")) < 0));
    const labels = controls.filter(visible).map((node) => node.getAttribute("aria-label") ?? node.textContent?.trim() ?? "");
    const duplicateLabels = [...new Set(labels)].map((label) => ({ label, count: labels.filter((value) => value === label).length })).filter(({ label, count }) => label && count > 1);
    const nodes = Array.from(document.querySelectorAll("*"));
    return { allInteractiveCount: controls.length, visibleInteractiveCount: controls.filter(visible).length, initiallyInViewportInteractiveCount: controls.filter((n) => visible(n) && n.getBoundingClientRect().top < innerHeight && n.getBoundingClientRect().bottom > 0).length, landmarks: Array.from(document.querySelectorAll("main,nav,aside,header")).filter(visible).map((node) => node.tagName), skipLinks: Array.from(document.querySelectorAll("a")).filter((n) => /skip/i.test(n.textContent ?? "")).length, maxDomDepth: Math.max(...nodes.map((node) => { let count=0; for(let current: Element|null=node;current;current=current.parentElement)count++; return count; })), duplicateLabels, badges: Array.from(document.querySelectorAll(".status-pill")).filter(visible).length, dialogs: document.querySelectorAll("dialog[open],[role=dialog]").length };
  })));
  console.log("AUDIT_CONTRAST", JSON.stringify(await page.evaluate(() => {
    const selectors = [".code-diff-line-added", ".code-diff-line-removed", ".code-diff-line-added .code-diff-line-marker", ".code-diff-line-removed .code-diff-line-marker", ".metadata-disclosure", ".notebook-subpath"];
    const rgb = (color: string) => (color.match(/[\d.]+/g) ?? []).map(Number);
    const luminance = (parts: number[]) => parts.slice(0,3).map((value) => { const s=value/255;return s<=.04045?s/12.92:Math.pow((s+.055)/1.055,2.4); }).reduce((sum,value,index)=>sum+value*[.2126,.7152,.0722][index],0);
    return selectors.map((selector) => { const node=document.querySelector(selector);if(!node)return {selector,absent:true}; const style=getComputedStyle(node);let ancestor:Element|null=node;let background="rgb(255,255,255)";while(ancestor){const current=getComputedStyle(ancestor).backgroundColor;const parsed=rgb(current);if(parsed.length===3||parsed[3]===1){background=current;break;}ancestor=ancestor.parentElement;} const fg=luminance(rgb(style.color)),bg=luminance(rgb(background));return {selector,color:style.color,background,fontSize:style.fontSize,contrastAgainstNearestOpaqueBackground:(Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05)};});
  })));
  console.log("AUDIT_HTML_OUTPUT", JSON.stringify(await Promise.all(page.frames().filter((f) => f !== page.mainFrame()).map(async (frame) => ({ text: await frame.locator("body").innerText(), tables: await frame.locator("table").count() })))));
  const tabs = [];
  await page.locator("body").click({ position: { x: 2, y: 2 } });
  for (let i=0;i<12;i++) { await page.keyboard.press("Tab"); tabs.push(await page.evaluate(()=>({tag:document.activeElement?.tagName,label:document.activeElement?.getAttribute("aria-label")??document.activeElement?.textContent?.trim(),scrollY}))); }
  console.log("AUDIT_KEYBOARD_FIRST_12",JSON.stringify(tabs));
  await page.getByRole("button",{name:"Discussions (2)",exact:true}).click();
  console.log("AUDIT_DISCUSSION_LANDMARKS",JSON.stringify(await page.evaluate(()=>Array.from(document.querySelectorAll("main,nav,aside,header")).filter(n=>n.getClientRects().length).map(n=>n.tagName))));
  await page.getByRole("button",{name:"Changes",exact:true}).click();
  await page.evaluate(()=>scrollTo(0,0));
  await page.screenshot({path:path.join(artifacts,"audit-detail-current-1440.png"),fullPage:true});
});
