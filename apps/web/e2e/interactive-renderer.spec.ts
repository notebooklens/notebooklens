/**
 * Real-browser verification of the sandboxed interactive output renderer.
 *
 * This loads the actual built bundle (`public/interactive-renderer/`) inside
 * a `sandbox="allow-scripts"` iframe (no `allow-same-origin`), exactly as the
 * review workspace embeds it, and drives it with `postMessage` the same way
 * the parent React component does. It exercises real Plotly.newPlot canvas
 * rendering and a real saved ipywidgets slider, and asserts hostile/malformed
 * payloads are rejected instead of executed.
 *
 * Run with: npx playwright test e2e/interactive-renderer.spec.ts
 * Requires `node interactive-renderer/build.mjs` to have produced
 * `public/interactive-renderer/bundle.js` first.
 */
import { test, expect } from "@playwright/test";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  INTERACTIVE_RENDERER_CHANNEL,
  type WidgetManagerState,
  type WidgetViewSpec,
} from "../lib/interactive-output";

declare global {
  interface Window {
    __messages: Array<Record<string, unknown>>;
    __send: (message: Record<string, unknown>) => void;
  }
}

const publicDir = path.join(__dirname, "..", "public");

const HARNESS_HTML = `<!doctype html>
<html>
  <body>
    <iframe
      id="renderer"
      src="/interactive-renderer/index.html"
      sandbox="allow-scripts"
      style="width: 640px; height: 480px; border: 0;"
    ></iframe>
    <script>
      window.__messages = [];
      window.addEventListener("message", (event) => {
        if (event.source !== document.getElementById("renderer").contentWindow) {
          return;
        }
        window.__messages.push(event.data);
      });
      window.__send = (message) => {
        document.getElementById("renderer").contentWindow.postMessage(message, "*");
      };
    </script>
  </body>
</html>`;

let server: Server;
let baseUrl: string;

async function handleStaticRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.url === "/harness") {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(HARNESS_HTML);
    return;
  }

  // Normalize and contain the resolved path within `publicDir`: a raw
  // `path.join` with an attacker-controlled URL (e.g. `/../../../etc/passwd`
  // or an encoded equivalent) would otherwise let this test-only server read
  // arbitrary files outside the intended directory.
  const requestedPath = decodeURIComponent((req.url ?? "").split("?")[0] ?? "");
  const resolvedPath = path.resolve(publicDir, `.${requestedPath}`);
  if (resolvedPath !== publicDir && !resolvedPath.startsWith(publicDir + path.sep)) {
    res.writeHead(403);
    res.end("forbidden");
    return;
  }

  try {
    const body = await readFile(resolvedPath);
    const ext = path.extname(resolvedPath);
    const contentType =
      ext === ".html" ? "text/html" : ext === ".js" ? "text/javascript" : ext === ".css" ? "text/css" : "application/octet-stream";
    // Mirror the response headers `next.config.ts` sets in production for
    // this path: Subresource Integrity on bundle.js requires a CORS-visible
    // response because the requesting document has an opaque origin
    // (sandbox="allow-scripts" without allow-same-origin).
    res.writeHead(200, {
      "content-type": contentType,
      "x-content-type-options": "nosniff",
      "access-control-allow-origin": "*",
    });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
}

test.beforeAll(async () => {
  server = createServer((req, res) => {
    void handleStaticRequest(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("failed to bind test server");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test("renders a real Plotly figure from a normalized spec", async ({ page }) => {
  await page.goto(`${baseUrl}/harness`);
  await page.waitForFunction(() => window.__messages.some((m) => m.type === "renderer-ready"));

  await page.evaluate(
    ({ channel }) => {
      window.__send({
        channel,
        type: "render-plotly",
        requestId: "req-1",
        spec: {
          data: [{ type: "bar", x: ["a", "b"], y: [1, 2] }],
          layout: { title: "Test figure" },
        },
      });
    },
    { channel: INTERACTIVE_RENDERER_CHANNEL },
  );

  await page.waitForFunction(
    () => window.__messages.some((m) => m.type === "render-complete" && m.requestId === "req-1"),
  );

  const frame = page.frameLocator("#renderer");
  await expect(frame.locator(".plotly .main-svg").first()).toBeVisible();
  await expect(frame.locator(".plotly .bars")).toBeVisible();
});

test("renders a real saved ipywidgets slider from saved state", async ({ page }) => {
  await page.goto(`${baseUrl}/harness`);
  await page.waitForFunction(() => window.__messages.some((m) => m.type === "renderer-ready"));

  const state: WidgetManagerState = {
    version_major: 2,
    version_minor: 0,
    state: {
      "slider-model": {
        model_name: "IntSliderModel",
        model_module: "@jupyter-widgets/controls",
        model_module_version: "2.0.0",
        state: {
          _model_name: "IntSliderModel",
          _view_name: "IntSliderView",
          _model_module: "@jupyter-widgets/controls",
          _view_module: "@jupyter-widgets/controls",
          _model_module_version: "2.0.0",
          _view_module_version: "2.0.0",
          value: 42,
          min: 0,
          max: 100,
          description: "Test slider",
        },
      },
    },
  };
  const view: WidgetViewSpec = { version_major: 2, version_minor: 0, model_id: "slider-model" };

  await page.evaluate(
    ({ channel, view, state }) => {
      window.__send({ channel, type: "render-widget", requestId: "req-2", view, state });
    },
    { channel: INTERACTIVE_RENDERER_CHANNEL, view, state },
  );

  await page.waitForFunction(
    () => window.__messages.some((m) => m.type === "render-complete" && m.requestId === "req-2"),
    undefined,
    { timeout: 10_000 },
  );

  const frame = page.frameLocator("#renderer");
  await expect(frame.locator(".widget-slider")).toBeVisible();
  const sliderStyle = await frame.locator(".widget-slider").evaluate((element) => {
    const style = getComputedStyle(element);
    const bounds = element.getBoundingClientRect();
    return {
      fontSizeToken: style.getPropertyValue("--jp-ui-font-size1").trim(),
      backgroundToken: style.getPropertyValue("--jp-layout-color1").trim(),
      width: bounds.width,
      height: bounds.height,
    };
  });
  expect(sliderStyle.fontSizeToken).toBe("13px");
  expect(sliderStyle.backgroundToken).not.toBe("");
  await expect(frame.locator(".widget-slider .widget-label")).toHaveCSS("font-size", "13px");
  expect(sliderStyle.width).toBeGreaterThan(100);
  expect(sliderStyle.height).toBeGreaterThanOrEqual(20);
  expect(sliderStyle.height).toBeLessThan(100);
});

test("rejects a widget whose inner state smuggles a non-standard _view_module past an allowed envelope", async ({ page }) => {
  await page.goto(`${baseUrl}/harness`);
  await page.waitForFunction(() => window.__messages.some((m) => m.type === "renderer-ready"));

  const state = {
    version_major: 2,
    version_minor: 0,
    state: {
      "smuggled-model": {
        // The envelope claims a standard, allowed module...
        model_name: "IntSliderModel",
        model_module: "@jupyter-widgets/controls",
        model_module_version: "2.0.0",
        state: {
          _model_name: "IntSliderModel",
          _model_module: "@jupyter-widgets/controls",
          _model_module_version: "2.0.0",
          // ...but the model's own attributes, which drive real view
          // construction, smuggle a hostile module reference.
          _view_name: "IntSliderView",
          _view_module: "https://evil.example/widget.js",
          _view_module_version: "2.0.0",
          value: 1,
        },
      },
    },
  };
  const view = { version_major: 2, version_minor: 0, model_id: "smuggled-model" };

  await page.evaluate(
    ({ channel, view, state }) => {
      window.__send({ channel, type: "render-widget", requestId: "req-smuggle", view, state });
    },
    { channel: INTERACTIVE_RENDERER_CHANNEL, view, state },
  );

  const message = await page.evaluate(async () => {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const found = window.__messages.find((m) => m.requestId === "req-smuggle");
      if (found) {
        return found;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return null;
  });

  expect(message).not.toBeNull();
  expect((message as { type: string }).type).toBe("render-unsupported");

  const frame = page.frameLocator("#renderer");
  await expect(frame.locator("body")).not.toContainText("evil.example");
});

test("neutralizes navigation/resource-bearing HTML inside a saved widget's own value and never fetches it", async ({ page }) => {
  const requestedUrls: string[] = [];
  page.on("request", (request) => {
    requestedUrls.push(request.url());
  });

  await page.goto(`${baseUrl}/harness`);
  await page.waitForFunction(() => window.__messages.some((m) => m.type === "renderer-ready"));

  const state = {
    version_major: 2,
    version_minor: 0,
    state: {
      "html-model": {
        model_name: "HTMLModel",
        model_module: "@jupyter-widgets/controls",
        model_module_version: "2.0.0",
        state: {
          _model_name: "HTMLModel",
          _view_name: "HTMLView",
          _model_module: "@jupyter-widgets/controls",
          _view_module: "@jupyter-widgets/controls",
          _model_module_version: "2.0.0",
          _view_module_version: "2.0.0",
          value:
            '<img src="https://exfiltrate.example/beacon.png"><a href="https://exfiltrate.example/steal">click</a>',
        },
      },
    },
  };
  const view = { version_major: 2, version_minor: 0, model_id: "html-model" };

  await page.evaluate(
    ({ channel, view, state }) => {
      window.__send({ channel, type: "render-widget", requestId: "req-html", view, state });
    },
    { channel: INTERACTIVE_RENDERER_CHANNEL, view, state },
  );

  await page.waitForFunction(
    () => window.__messages.some((m) => m.type === "render-complete" && m.requestId === "req-html"),
    undefined,
    { timeout: 10_000 },
  );

  const frame = page.frameLocator("#renderer");
  await expect(frame.locator("a")).toHaveAttribute("href", "#");
  await expect(frame.locator("img")).toHaveAttribute("src", "");

  const externalRequests = requestedUrls.filter((url) => url.includes("exfiltrate.example"));
  expect(externalRequests).toEqual([]);
});

for (const className of ["constructor", "toString"]) {
  test(`rejects inherited widget class ${className} in an allowed module`, async ({ page }) => {
    await page.goto(`${baseUrl}/harness`);
    await page.waitForFunction(() => window.__messages.some((m) => m.type === "renderer-ready"));
    await page.evaluate(({ channel, className }) => {
      window.__send({
        channel, type: "render-widget", requestId: "req-inherited",
        view: { version_major: 2, version_minor: 0, model_id: "inherited" },
        state: {
          version_major: 2, version_minor: 0,
          state: { inherited: {
            model_name: className, model_module: "@jupyter-widgets/controls", model_module_version: "2.0.0",
            state: { _model_name: className, _model_module: "@jupyter-widgets/controls", _model_module_version: "2.0.0" },
          } },
        },
      });
    }, { channel: INTERACTIVE_RENDERER_CHANNEL, className });
    await page.waitForFunction(() => window.__messages.some((m) => m.requestId === "req-inherited"));
    const messages = await page.evaluate(() => window.__messages.filter((m) => m.requestId === "req-inherited"));
    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe("render-error");
    expect(String(messages[0].reason)).toContain(`Class "${className}" was not found`);
  });
}

test("strips meta refresh from HTML widgets without navigating or making external requests", async ({ page }) => {
  const requestedUrls: string[] = [];
  const navigatedUrls: string[] = [];
  page.on("request", (request) => requestedUrls.push(request.url()));
  page.on("framenavigated", (frame) => navigatedUrls.push(frame.url()));
  await page.goto(`${baseUrl}/harness`);
  await page.waitForFunction(() => window.__messages.some((m) => m.type === "renderer-ready"));
  const navigationCount = navigatedUrls.length;
  await page.evaluate(({ channel }) => {
    window.__send({
      channel, type: "render-widget", requestId: "req-refresh",
      view: { version_major: 2, version_minor: 0, model_id: "html" },
      state: {
        version_major: 2, version_minor: 0,
        state: { html: {
          model_name: "HTMLModel", model_module: "@jupyter-widgets/controls", model_module_version: "2.0.0",
          state: {
            _model_name: "HTMLModel", _view_name: "HTMLView",
            _model_module: "@jupyter-widgets/controls", _view_module: "@jupyter-widgets/controls",
            _model_module_version: "2.0.0", _view_module_version: "2.0.0",
            value: '<meta http-equiv="refresh" content="0;url=https://exfiltrate.example/refresh"><span>Safe content</span>',
          },
        } },
      },
    });
  }, { channel: INTERACTIVE_RENDERER_CHANNEL });
  await page.waitForFunction(() => window.__messages.some((m) => m.type === "render-complete" && m.requestId === "req-refresh"));
  const frame = page.frameLocator("#renderer");
  await expect(frame.locator("#root")).toContainText("Safe content");
  await expect(frame.locator("#root meta")).toHaveCount(0);
  // Give a zero-delay refresh a chance to run; absence of the tag alone is
  // insufficient if a browser scheduled navigation before it was removed.
  await page.waitForTimeout(250);
  expect(navigatedUrls).toHaveLength(navigationCount);
  expect(requestedUrls.filter((url) => url.includes("exfiltrate.example"))).toEqual([]);
});

test("reports an explicit unsupported notice for a non-standard widget module instead of loading it", async ({ page }) => {
  await page.goto(`${baseUrl}/harness`);
  await page.waitForFunction(() => window.__messages.some((m) => m.type === "renderer-ready"));

  const state = {
    version_major: 2,
    version_minor: 0,
    state: {
      "hostile-model": {
        model_name: "HostileModel",
        model_module: "https://evil.example/widget.js",
        model_module_version: "1.0.0",
        state: {},
      },
    },
  };
  const view = { version_major: 2, version_minor: 0, model_id: "hostile-model" };

  await page.evaluate(
    ({ channel, view, state }) => {
      window.__send({ channel, type: "render-widget", requestId: "req-3", view, state });
    },
    { channel: INTERACTIVE_RENDERER_CHANNEL, view, state },
  );

  const message = await page.evaluate(async () => {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const found = window.__messages.find((m) => m.requestId === "req-3");
      if (found) {
        return found;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return null;
  });

  expect(message).not.toBeNull();
  expect((message as { type: string }).type).toBe("render-unsupported");

  const frame = page.frameLocator("#renderer");
  await expect(frame.locator("body")).not.toContainText("evil.example");
});

test("never issues outbound network requests from inside the sandboxed renderer", async ({ page }) => {
  const requestedUrls: string[] = [];
  page.on("request", (request) => {
    requestedUrls.push(request.url());
  });

  await page.goto(`${baseUrl}/harness`);
  await page.waitForFunction(() => window.__messages.some((m) => m.type === "renderer-ready"));

  await page.evaluate(
    ({ channel }) => {
      window.__send({
        channel,
        type: "render-plotly",
        requestId: "req-4",
        spec: { data: [{ type: "scatter", x: [1, 2, 3], y: [3, 1, 2] }] },
      });
    },
    { channel: INTERACTIVE_RENDERER_CHANNEL },
  );

  await page.waitForFunction(
    () => window.__messages.some((m) => m.type === "render-complete" && m.requestId === "req-4"),
  );

  const externalRequests = requestedUrls.filter((url) => !url.startsWith(baseUrl));
  expect(externalRequests).toEqual([]);
});
