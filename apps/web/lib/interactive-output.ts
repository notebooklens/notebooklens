/**
 * Wire protocol and validation shared between the review workspace (parent
 * page) and the sandboxed interactive output renderer (iframe).
 *
 * This module intentionally has no React/Next/DOM-only dependencies so it can
 * be bundled both by Next.js (for the parent page) and by the standalone
 * esbuild bundle that ships to `public/interactive-renderer/bundle.js` (for
 * the sandboxed iframe). Keep it framework-agnostic.
 */

export const INTERACTIVE_RENDERER_CHANNEL = "notebooklens-interactive-renderer";

/**
 * Bounded so a hostile or corrupted spec cannot exhaust the renderer. Set
 * comfortably above the backend's own bound (`_INTERACTIVE_SPEC_MAX_BYTES`,
 * 2_097_152 bytes in `src/review_core.py`) so this is a backstop against a
 * tampered/corrupted payload, not a second place the real limit has to be
 * kept in sync.
 */
export const MAX_PLOTLY_SPEC_BYTES = 4_000_000;
export const MAX_WIDGET_STATE_BYTES = 4_000_000;

/**
 * Widget JavaScript modules NotebookLens explicitly supports embedding.
 * `@jupyter-widgets/output` is deliberately excluded: it can replay arbitrary
 * notebook mimetypes (including sanitized HTML) inside the widget, which
 * widens the trusted rendering surface beyond "standard saved widgets".
 * Anything outside this list is reported as an explicit "unsupported" state
 * instead of being instantiated.
 */
export const SUPPORTED_WIDGET_MODULES: ReadonlySet<string> = new Set([
  "@jupyter-widgets/base",
  "@jupyter-widgets/controls",
]);

export type PlotlyRenderSpec = {
  data: unknown[];
  layout?: Record<string, unknown>;
  config?: Record<string, unknown>;
};

export type WidgetManagerState = {
  version_major: number;
  version_minor: number;
  state: Record<
    string,
    {
      model_name: string;
      model_module: string;
      model_module_version?: string;
      state: Record<string, unknown>;
      [key: string]: unknown;
    }
  >;
};

export type WidgetViewSpec = {
  version_major?: number;
  version_minor?: number;
  model_id: string;
};

export type RenderPlotlyRequest = {
  channel: typeof INTERACTIVE_RENDERER_CHANNEL;
  type: "render-plotly";
  requestId: string;
  spec: PlotlyRenderSpec;
};

export type RenderWidgetRequest = {
  channel: typeof INTERACTIVE_RENDERER_CHANNEL;
  type: "render-widget";
  requestId: string;
  view: WidgetViewSpec;
  state: WidgetManagerState;
};

export type RendererInboundMessage = RenderPlotlyRequest | RenderWidgetRequest;

export type RendererReadyMessage = {
  channel: typeof INTERACTIVE_RENDERER_CHANNEL;
  type: "renderer-ready";
};

export type RendererCompleteMessage = {
  channel: typeof INTERACTIVE_RENDERER_CHANNEL;
  type: "render-complete";
  requestId: string;
  height: number;
};

export type RendererErrorMessage = {
  channel: typeof INTERACTIVE_RENDERER_CHANNEL;
  type: "render-error";
  requestId: string;
  reason: string;
};

export type RendererUnsupportedMessage = {
  channel: typeof INTERACTIVE_RENDERER_CHANNEL;
  type: "render-unsupported";
  requestId: string;
  reason: string;
};

export type RendererOutboundMessage =
  | RendererReadyMessage
  | RendererCompleteMessage
  | RendererErrorMessage
  | RendererUnsupportedMessage;

export type ValidationResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      reason: "malformed" | "oversized" | "unsupported-module" | "unsupported-trace";
      message: string;
    };

function byteSizeOf(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value) ?? "").length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Plotly trace types that need to fetch map tiles, topojson geometry, or
 * other resources over the network at render time. The renderer's CSP
 * blocks all network access (`connect-src 'none'`), so these traces would
 * otherwise render silently blank instead of failing visibly.
 */
const NETWORK_DEPENDENT_TRACE_TYPES: ReadonlySet<string> = new Set([
  "scattermapbox",
  "choroplethmapbox",
  "densitymapbox",
  "scattermap",
  "choroplethmap",
  "densitymap",
  "scattergeo",
  "choropleth",
]);

function findNetworkDependentTraceType(data: unknown[]): string | null {
  for (const trace of data) {
    if (isPlainObject(trace) && typeof trace.type === "string" && NETWORK_DEPENDENT_TRACE_TYPES.has(trace.type)) {
      return trace.type;
    }
  }
  return null;
}

/** Plotly `config` keys NotebookLens allows through from the notebook's own saved config. */
const PLOTLY_CONFIG_ALLOWLIST: ReadonlySet<string> = new Set([
  "responsive",
  "displayModeBar",
  "scrollZoom",
  "staticPlot",
  "doubleClick",
  "showAxisDragHandles",
  "showAxisRangeEntryBoxes",
  "showTips",
  "modeBarButtonsToRemove",
]);

/**
 * Builds a hardened Plotly config: only allowlisted keys pass through from
 * the caller-supplied config, and security-relevant flags are then forced to
 * safe values *after* that merge so nothing in the notebook's saved config
 * can re-enable them. This blocks the "send to cloud" / "edit in Chart
 * Studio" flows (both would otherwise phone data to a third-party service),
 * remote `plotlyServerURL`/topojson overrides, custom mode bar buttons
 * (`modeBarButtonsToAdd` cannot carry real functions through JSON, but a
 * string-keyed button lookup is still not something we support), and the
 * "download as image" button, which cannot function from a sandboxed iframe
 * without `allow-downloads` and would otherwise fail with no explanation.
 */
function sanitizePlotlyConfig(rawConfig: Record<string, unknown> | undefined): Record<string, unknown> {
  const allowed: Record<string, unknown> = {};
  if (rawConfig) {
    for (const key of Object.keys(rawConfig)) {
      if (!PLOTLY_CONFIG_ALLOWLIST.has(key)) {
        continue;
      }
      if (key === "modeBarButtonsToRemove") {
        const value = rawConfig[key];
        if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) {
          allowed[key] = value;
        }
        continue;
      }
      allowed[key] = rawConfig[key];
    }
  }

  const removedButtons = new Set(
    Array.isArray(allowed.modeBarButtonsToRemove) ? (allowed.modeBarButtonsToRemove as string[]) : [],
  );
  removedButtons.add("toImage");
  removedButtons.add("sendDataToCloud");

  return {
    ...allowed,
    displaylogo: false,
    showSendToCloud: false,
    showEditInChartStudio: false,
    modeBarButtonsToAdd: [],
    modeBarButtonsToRemove: Array.from(removedButtons),
    plotlyServerURL: undefined,
    topojsonURL: undefined,
    mapboxAccessToken: undefined,
  };
}

/**
 * Validate an untrusted candidate Plotly spec. Only structural checks are
 * performed here (this never evaluates code); malformed or oversized specs
 * are rejected visibly rather than silently truncated. The returned spec's
 * `config` is always the hardened, allowlisted version, never the raw
 * caller-supplied object.
 */
export function validatePlotlySpec(candidate: unknown): ValidationResult<PlotlyRenderSpec> {
  if (!isPlainObject(candidate)) {
    return { ok: false, reason: "malformed", message: "Plotly spec is not an object." };
  }
  if (!Array.isArray(candidate.data)) {
    return { ok: false, reason: "malformed", message: "Plotly spec is missing a data array." };
  }
  if (candidate.layout !== undefined && !isPlainObject(candidate.layout)) {
    return { ok: false, reason: "malformed", message: "Plotly spec layout must be an object." };
  }
  if (candidate.config !== undefined && !isPlainObject(candidate.config)) {
    return { ok: false, reason: "malformed", message: "Plotly spec config must be an object." };
  }

  const byteSize = byteSizeOf(candidate);
  if (byteSize > MAX_PLOTLY_SPEC_BYTES) {
    return {
      ok: false,
      reason: "oversized",
      message: `Plotly spec (${byteSize} bytes) exceeds ${MAX_PLOTLY_SPEC_BYTES} bytes.`,
    };
  }

  const networkTraceType = findNetworkDependentTraceType(candidate.data);
  if (networkTraceType !== null) {
    return {
      ok: false,
      reason: "unsupported-trace",
      message: `"${networkTraceType}" traces need map tiles or geometry from the network, which this offline renderer blocks.`,
    };
  }

  return {
    ok: true,
    value: {
      // Trace and layout strings (titles, hovertemplates, annotation text,
      // custom axis labels, etc.) can carry the same HTML-injection surface
      // the saved-widget-state sanitizer below exists to neutralize, so
      // reuse it here rather than passing Plotly's own data/layout through
      // unsanitized.
      data: sanitizeHtmlBearingValue(candidate.data, 0) as unknown[],
      layout:
        candidate.layout !== undefined
          ? (sanitizeHtmlBearingValue(candidate.layout, 0) as Record<string, unknown>)
          : undefined,
      config: sanitizePlotlyConfig(candidate.config),
    },
  };
}

/**
 * Validate an untrusted candidate saved-widget manager state
 * (`application/vnd.jupyter.widget-state+json`, schema v2) together with the
 * view spec (`application/vnd.jupyter.widget-view+json`) that selects which
 * model to display. Widget state always originates from each side's own
 * notebook metadata, never from a live kernel.
 */
export function validateWidgetPayload(
  viewCandidate: unknown,
  stateCandidate: unknown,
): ValidationResult<{ view: WidgetViewSpec; state: WidgetManagerState }> {
  if (!isPlainObject(stateCandidate)) {
    return { ok: false, reason: "malformed", message: "Widget state is not an object." };
  }
  if (stateCandidate.version_major !== 2) {
    return { ok: false, reason: "malformed", message: "Widget state schema version is not supported." };
  }
  if (!isPlainObject(stateCandidate.state)) {
    return { ok: false, reason: "malformed", message: "Widget state is missing a model state map." };
  }
  if (!isPlainObject(viewCandidate) || typeof viewCandidate.model_id !== "string") {
    return { ok: false, reason: "malformed", message: "Widget view is missing a model_id." };
  }

  const modelStates = stateCandidate.state;
  const modelIds = Object.keys(modelStates);
  if (modelIds.length === 0) {
    return { ok: false, reason: "malformed", message: "Widget state has no saved models." };
  }

  const unsupportedModules = new Set<string>();
  for (const modelId of modelIds) {
    const model = modelStates[modelId];
    if (
      !isPlainObject(model) ||
      typeof model.model_name !== "string" ||
      typeof model.model_module !== "string" ||
      !isPlainObject(model.state)
    ) {
      return {
        ok: false,
        reason: "malformed",
        message: `Widget model "${modelId}" is missing required fields.`,
      };
    }
    if (!SUPPORTED_WIDGET_MODULES.has(model.model_module)) {
      unsupportedModules.add(model.model_module);
    }

    // The envelope's `model_module` is what NotebookLens' own check above
    // covers, but @jupyter-widgets/base-manager's `create_view` reads the
    // *model's own attributes* (`_model_module`, `_view_module`, inside
    // `model.state`, not the envelope) to decide which JS module to load for
    // construction and for the view. A payload could pass an allowed
    // envelope while smuggling a hostile module reference in these inner
    // fields, so they must be checked too, not just the envelope.
    for (const innerModuleField of ["_model_module", "_view_module"] as const) {
      const innerModule = model.state[innerModuleField];
      if (innerModule === undefined) {
        continue;
      }
      if (typeof innerModule !== "string" || !SUPPORTED_WIDGET_MODULES.has(innerModule)) {
        unsupportedModules.add(typeof innerModule === "string" ? innerModule : `<invalid ${innerModuleField}>`);
      }
    }
  }

  if (unsupportedModules.has("@jupyter-widgets/output")) {
    return {
      ok: false,
      reason: "unsupported-module",
      message: "This saved widget uses an Output widget, which NotebookLens does not embed.",
    };
  }
  if (unsupportedModules.size > 0) {
    return {
      ok: false,
      reason: "unsupported-module",
      message: `This saved widget uses unsupported module(s): ${Array.from(unsupportedModules).join(", ")}.`,
    };
  }

  if (!modelIds.includes(viewCandidate.model_id)) {
    return { ok: false, reason: "malformed", message: "Widget view references a model that is not saved in state." };
  }

  const byteSize = byteSizeOf(stateCandidate);
  if (byteSize > MAX_WIDGET_STATE_BYTES) {
    return {
      ok: false,
      reason: "oversized",
      message: `Widget state (${byteSize} bytes) exceeds ${MAX_WIDGET_STATE_BYTES} bytes.`,
    };
  }

  const sanitizedModels: WidgetManagerState["state"] = {};
  for (const modelId of modelIds) {
    const model = modelStates[modelId] as {
      model_name: string;
      model_module: string;
      model_module_version?: string;
      state: Record<string, unknown>;
      [key: string]: unknown;
    };
    sanitizedModels[modelId] = {
      ...model,
      state: sanitizeHtmlBearingValue(model.state, 0) as Record<string, unknown>,
    };
  }

  return {
    ok: true,
    value: {
      view: viewCandidate as unknown as WidgetViewSpec,
      state: {
        version_major: stateCandidate.version_major as number,
        version_minor: stateCandidate.version_minor as number,
        state: sanitizedModels,
      },
    },
  };
}

const MAX_WIDGET_SANITIZE_DEPTH = 8;

/**
 * Neutralizes navigation- and resource-loading-bearing HTML fragments inside
 * a saved widget's own string attributes (e.g. an `HTMLModel`'s `value`,
 * which `@jupyter-widgets/controls`' `HTMLView` sets via raw
 * `element.innerHTML` with no sanitization of its own). The renderer's CSP
 * already blocks script execution and non-bundled network loads for this
 * content, but this strips the navigation/resource-bearing markup itself as
 * defense in depth rather than relying solely on CSP enforcement.
 */
function sanitizeHtmlBearingString(value: string): string {
  let result = value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<script\b[^>]*\/?>/gi, "");
  result = result.replace(/<meta\b[^>]*>/gi, "");
  result = result.replace(/\bhref\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, 'href="#"');
  result = result.replace(/\bsrc\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, 'src=""');
  result = result.replace(/javascript:/gi, "blocked:");
  return result;
}

function sanitizeHtmlBearingValue(value: unknown, depth: number): unknown {
  if (depth > MAX_WIDGET_SANITIZE_DEPTH) {
    return value;
  }
  if (typeof value === "string") {
    return sanitizeHtmlBearingString(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeHtmlBearingValue(entry, depth + 1));
  }
  if (isPlainObject(value)) {
    const sanitized: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      sanitized[key] = sanitizeHtmlBearingValue(value[key], depth + 1);
    }
    return sanitized;
  }
  return value;
}

function isKnownInboundType(value: unknown): value is RendererInboundMessage["type"] {
  return value === "render-plotly" || value === "render-widget";
}

/** Used inside the sandboxed iframe to validate messages claiming to come from the parent page. */
export function isRenderRequestMessage(candidate: unknown): candidate is RendererInboundMessage {
  if (!isPlainObject(candidate)) {
    return false;
  }
  if (candidate.channel !== INTERACTIVE_RENDERER_CHANNEL) {
    return false;
  }
  if (!isKnownInboundType(candidate.type)) {
    return false;
  }
  if (typeof candidate.requestId !== "string" || candidate.requestId.length === 0) {
    return false;
  }
  if (candidate.type === "render-plotly") {
    return isPlainObject(candidate.spec);
  }
  return isPlainObject(candidate.view) && isPlainObject(candidate.state);
}

function isKnownOutboundType(value: unknown): value is RendererOutboundMessage["type"] {
  return (
    value === "renderer-ready" ||
    value === "render-complete" ||
    value === "render-error" ||
    value === "render-unsupported"
  );
}

/** Used by the parent page to validate messages claiming to come from the renderer iframe. */
export function isRendererStatusMessage(candidate: unknown): candidate is RendererOutboundMessage {
  if (!isPlainObject(candidate)) {
    return false;
  }
  if (candidate.channel !== INTERACTIVE_RENDERER_CHANNEL) {
    return false;
  }
  if (!isKnownOutboundType(candidate.type)) {
    return false;
  }
  if (candidate.type === "renderer-ready") {
    return true;
  }
  if (typeof candidate.requestId !== "string" || candidate.requestId.length === 0) {
    return false;
  }
  if (candidate.type === "render-complete") {
    return typeof candidate.height === "number" && Number.isFinite(candidate.height);
  }
  return typeof candidate.reason === "string";
}
