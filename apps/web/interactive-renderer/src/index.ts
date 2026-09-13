/**
 * Entry point for the sandboxed interactive output renderer.
 *
 * This script runs inside an opaque-origin iframe
 * (`sandbox="allow-scripts"`, deliberately without `allow-same-origin`) that
 * the review workspace embeds for Plotly figures and saved ipywidgets state.
 * It never evaluates notebook script content: it only accepts normalized
 * Plotly JSON or saved widget manager state over `postMessage`, validates the
 * shape and size of that data, and renders it with locally bundled trusted
 * dependencies (`plotly.js-dist-min`, and a minimal saved-widget manager
 * built on `@jupyter-widgets/base`/`@jupyter-widgets/controls` — see
 * `widget-manager.ts` for why this does not use
 * `@jupyter-widgets/html-manager` directly).
 */
import Plotly from "plotly.js-dist-min";

import {
  INTERACTIVE_RENDERER_CHANNEL,
  RendererOutboundMessage,
  isRenderRequestMessage,
  validatePlotlySpec,
  validateWidgetPayload,
} from "../../lib/interactive-output";
import { MinimalWidgetManager, UnsupportedWidgetVersionError } from "./widget-manager";

const root = document.getElementById("root");

function post(message: RendererOutboundMessage): void {
  window.parent.postMessage(message, "*");
}

function reportHeight(requestId: string): void {
  if (!root) {
    return;
  }
  const measured = Math.ceil(root.getBoundingClientRect().height || root.scrollHeight || 0);
  post({
    channel: INTERACTIVE_RENDERER_CHANNEL,
    type: "render-complete",
    requestId,
    height: Math.max(measured, 1),
  });
}

async function handlePlotlyRequest(requestId: string, rawSpec: unknown): Promise<void> {
  const validated = validatePlotlySpec(rawSpec);
  if (!validated.ok) {
    post({ channel: INTERACTIVE_RENDERER_CHANNEL, type: "render-error", requestId, reason: validated.message });
    return;
  }
  if (!root) {
    return;
  }
  try {
    await Plotly.newPlot(
      root,
      validated.value.data as Plotly.Data[],
      (validated.value.layout ?? {}) as Partial<Plotly.Layout>,
      {
        responsive: true,
        displaylogo: false,
        ...(validated.value.config ?? {}),
      } as Partial<Plotly.Config>,
    );
    reportHeight(requestId);
  } catch (error) {
    post({
      channel: INTERACTIVE_RENDERER_CHANNEL,
      type: "render-error",
      requestId,
      reason: error instanceof Error ? error.message : "Plotly could not render this figure.",
    });
  }
}

async function handleWidgetRequest(requestId: string, rawView: unknown, rawState: unknown): Promise<void> {
  const validated = validateWidgetPayload(rawView, rawState);
  if (!validated.ok) {
    post({
      channel: INTERACTIVE_RENDERER_CHANNEL,
      type: validated.reason === "unsupported-module" ? "render-unsupported" : "render-error",
      requestId,
      reason: validated.message,
    });
    return;
  }
  if (!root) {
    return;
  }
  try {
    // Only the bundled `@jupyter-widgets/base` and `@jupyter-widgets/controls`
    // modules resolve (see widget-manager.ts); any other module name rejects.
    // That is already screened out by `validateWidgetPayload` above (both
    // the envelope and the model's own inner `_model_module`/`_view_module`
    // fields); this is defense in depth, not the primary control.
    const manager = new MinimalWidgetManager();
    const models = await manager.set_state(validated.value.state as never);
    manager.assertClassesLoaded();
    const model = models.find((candidate) => candidate.model_id === validated.value.view.model_id);
    if (!model) {
      post({
        channel: INTERACTIVE_RENDERER_CHANNEL,
        type: "render-error",
        requestId,
        reason: "Saved widget state does not contain the requested view's model.",
      });
      return;
    }
    const view = await manager.create_view(model);
    manager.assertClassesLoaded();
    await manager.display_view(view, root);
    manager.assertClassesLoaded();
    reportHeight(requestId);
  } catch (error) {
    if (error instanceof UnsupportedWidgetVersionError) {
      post({ channel: INTERACTIVE_RENDERER_CHANNEL, type: "render-unsupported", requestId, reason: error.message });
      return;
    }
    post({
      channel: INTERACTIVE_RENDERER_CHANNEL,
      type: "render-error",
      requestId,
      reason: error instanceof Error ? error.message : "This saved widget could not be rendered.",
    });
  }
}

window.addEventListener("message", (event: MessageEvent) => {
  // Only the page that embedded this sandboxed iframe may drive it.
  if (event.source !== window.parent) {
    return;
  }
  if (!isRenderRequestMessage(event.data)) {
    return;
  }
  const message = event.data;
  if (root) {
    root.innerHTML = "";
  }
  if (message.type === "render-plotly") {
    void handlePlotlyRequest(message.requestId, message.spec);
    return;
  }
  void handleWidgetRequest(message.requestId, message.view, message.state);
});

post({ channel: INTERACTIVE_RENDERER_CHANNEL, type: "renderer-ready" });
