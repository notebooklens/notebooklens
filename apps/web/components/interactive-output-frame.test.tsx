// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { INTERACTIVE_RENDERER_CHANNEL, type RendererInboundMessage } from "@/lib/interactive-output";
import type { RenderOutputPlotlyItem } from "@/lib/types";
import { InteractiveOutputFrame } from "./interactive-output-frame";

afterEach(() => {
  cleanup();
});

function dispatchFromIframe(iframe: HTMLIFrameElement, data: unknown) {
  const event = new MessageEvent("message", { data, source: iframe.contentWindow as unknown as Window });
  window.dispatchEvent(event);
}

describe("InteractiveOutputFrame", () => {
  it("remounts a changed item and sends the new payload with a fresh request identity", () => {
    const item: RenderOutputPlotlyItem = { kind: "plotly", spec: { data: [{ y: [1] }] }, summary: "Figure", truncated: false, change_type: "modified" };
    const { container, rerender } = render(<InteractiveOutputFrame item={item} />);
    const original = container.querySelector("iframe")!;
    const originalSend = vi.fn<(message: RendererInboundMessage, targetOrigin: string) => void>();
    Object.defineProperty(original, "contentWindow", { value: { postMessage: originalSend }, configurable: true });
    act(() => dispatchFromIframe(original, { channel: INTERACTIVE_RENDERER_CHANNEL, type: "renderer-ready" }));
    const originalRequest = originalSend.mock.calls[0][0];
    act(() => dispatchFromIframe(original, { channel: INTERACTIVE_RENDERER_CHANNEL, type: "render-complete", requestId: originalRequest.requestId, height: 400 }));

    rerender(<InteractiveOutputFrame item={{ ...item, spec: { data: [{ y: [2] }] } }} />);
    const replacement = container.querySelector("iframe")!;
    expect(replacement).not.toBe(original);
    expect(original.isConnected).toBe(false);
    const replacementSend = vi.fn<(message: Extract<RendererInboundMessage, { type: "render-plotly" }>, targetOrigin: string) => void>();
    Object.defineProperty(replacement, "contentWindow", { value: { postMessage: replacementSend }, configurable: true });
    act(() => dispatchFromIframe(original, { channel: INTERACTIVE_RENDERER_CHANNEL, type: "renderer-ready" }));
    expect(replacementSend).not.toHaveBeenCalled();
    act(() => dispatchFromIframe(replacement, { channel: INTERACTIVE_RENDERER_CHANNEL, type: "renderer-ready" }));
    expect(replacementSend).toHaveBeenCalledTimes(1);
    expect(replacementSend.mock.calls[0][0].requestId).not.toBe(originalRequest.requestId);
    expect(replacementSend.mock.calls[0][0].spec.data).toEqual([{ y: [2] }]);
  });

  it("preserves the rendered iframe and height when rerendered with the same item reference", () => {
    const item: RenderOutputPlotlyItem = { kind: "plotly", spec: { data: [] }, summary: "Figure", truncated: false, change_type: "modified" };
    const { container, rerender } = render(<InteractiveOutputFrame item={item} />);
    const iframe = container.querySelector("iframe")!;
    const postMessage = vi.fn<(message: RendererInboundMessage, targetOrigin: string) => void>();
    Object.defineProperty(iframe, "contentWindow", { value: { postMessage }, configurable: true });
    act(() => dispatchFromIframe(iframe, { channel: INTERACTIVE_RENDERER_CHANNEL, type: "renderer-ready" }));
    act(() => dispatchFromIframe(iframe, { channel: INTERACTIVE_RENDERER_CHANNEL, type: "render-complete", requestId: postMessage.mock.calls[0][0].requestId, height: 420 }));
    rerender(<InteractiveOutputFrame item={item} />);
    expect(container.querySelector("iframe")).toBe(iframe);
    expect(iframe.getAttribute("height")).toBe("420");
    act(() => dispatchFromIframe(iframe, { channel: INTERACTIVE_RENDERER_CHANNEL, type: "renderer-ready" }));
    expect(postMessage).toHaveBeenCalledTimes(1);
  });

  it("sends the render request only once even if 'renderer-ready' arrives again from the same frame", async () => {
    const { container } = render(
      <InteractiveOutputFrame item={{ kind: "plotly", spec: { data: [{ type: "bar", y: [1, 2, 3] }] }, summary: "Plotly figure updated", truncated: false, change_type: "modified" }} />,
    );

    const iframe = container.querySelector("iframe");
    expect(iframe).not.toBeNull();
    if (!iframe) {
      return;
    }

    const postMessageSpy = vi.fn();
    Object.defineProperty(iframe, "contentWindow", {
      value: { postMessage: postMessageSpy },
      configurable: true,
    });

    // Simulate the real renderer's initial "ready" signal, then a *second*
    // "ready" signal from the same WindowProxy identity as if the framed
    // document had self-navigated and a new (possibly hostile) document
    // sent its own "renderer-ready"-shaped message. A WindowProxy keeps its
    // identity across navigations of that frame, so `event.source` alone
    // cannot distinguish the two documents; the payload must still only be
    // sent once.
    dispatchFromIframe(iframe, { channel: INTERACTIVE_RENDERER_CHANNEL, type: "renderer-ready" });
    dispatchFromIframe(iframe, { channel: INTERACTIVE_RENDERER_CHANNEL, type: "renderer-ready" });
    dispatchFromIframe(iframe, { channel: INTERACTIVE_RENDERER_CHANNEL, type: "renderer-ready" });

    await waitFor(() => {
      expect(postMessageSpy).toHaveBeenCalledTimes(1);
    });

    const [sentMessage] = postMessageSpy.mock.calls[0] as [{ type: string; spec: { data: unknown; config: Record<string, unknown> } }];
    expect(sentMessage.type).toBe("render-plotly");
    expect(sentMessage.spec.data).toEqual([{ type: "bar", y: [1, 2, 3] }]);
    // The sent spec is the hardened/allowlisted config, not a raw echo.
    expect(sentMessage.spec.config.showSendToCloud).toBe(false);
  });

  it("ignores messages whose event.source is not this component's own iframe", async () => {
    const { container } = render(
      <InteractiveOutputFrame item={{ kind: "plotly", spec: { data: [] }, summary: "Plotly figure updated", truncated: false, change_type: "modified" }} />,
    );

    const iframe = container.querySelector("iframe");
    expect(iframe).not.toBeNull();
    if (!iframe) {
      return;
    }

    const postMessageSpy = vi.fn();
    Object.defineProperty(iframe, "contentWindow", {
      value: { postMessage: postMessageSpy },
      configurable: true,
    });

    const impostorWindow = { postMessage: vi.fn() };
    const event = new MessageEvent("message", {
      data: { channel: INTERACTIVE_RENDERER_CHANNEL, type: "renderer-ready" },
      source: impostorWindow as unknown as Window,
    });
    window.dispatchEvent(event);

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(postMessageSpy).not.toHaveBeenCalled();
  });

  it("rejects a malformed spec before ever mounting the iframe", () => {
    const { container } = render(
      <InteractiveOutputFrame item={{ kind: "plotly", spec: { data: "not-an-array" } as never, summary: "Plotly figure updated", truncated: false, change_type: "modified" }} />,
    );

    expect(container.querySelector("iframe")).toBeNull();
    expect(container.textContent).toContain("Rejected:");
  });
});
