"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

import {
  INTERACTIVE_RENDERER_CHANNEL,
  isRendererStatusMessage,
  validatePlotlySpec,
  validateWidgetPayload,
  type RendererInboundMessage,
  type ValidationResult,
  type PlotlyRenderSpec,
  type WidgetManagerState,
  type WidgetViewSpec,
} from "@/lib/interactive-output";
import type { RenderOutputPlotlyItem, RenderOutputWidgetItem } from "@/lib/types";

const RENDERER_SRC = "/interactive-renderer/index.html";
const RENDER_TIMEOUT_MS = 12_000;
const MIN_FRAME_HEIGHT = 80;
const MAX_FRAME_HEIGHT = 1200;

type ValidatedRequest =
  | { kind: "plotly"; spec: PlotlyRenderSpec }
  | { kind: "widget"; view: WidgetViewSpec; state: WidgetManagerState };

type LoadState =
  | { status: "loading" }
  | { status: "ready"; height: number }
  | { status: "error"; message: string }
  | { status: "unsupported"; message: string }
  | { status: "timeout" };

/**
 * Embeds the sandboxed interactive output renderer for a single Plotly
 * figure or saved ipywidgets state. The iframe is `sandbox="allow-scripts"`
 * with no `allow-same-origin`, so it always has an opaque origin: it cannot
 * read cookies/storage from this page, and messages from it are verified by
 * comparing `event.source` to this iframe's own `contentWindow`, not by
 * origin string (which is always `"null"` for an opaque origin).
 *
 * Validation of the incoming spec/state runs synchronously during render
 * (not in an effect): a malformed or unsupported payload never mounts the
 * iframe at all, so there is no flash of an iframe that is about to fail.
 *
 * Takes the notebook `item` directly (a stable reference from the snapshot
 * payload) rather than a freshly-allocated wrapper object, so unrelated
 * re-renders of the page (e.g. opening a comment composer elsewhere) do not
 * change this component's dependency identity and spuriously reset an
 * already-rendered figure back to "loading".
 *
 * The render request is sent at most once per mount: a `WindowProxy`
 * (`iframe.contentWindow`) keeps its identity even if the framed document
 * later navigates itself, so a second "renderer-ready" message (from a since
 * self-navigated frame) must never trigger resending the notebook's data to
 * whatever document now occupies that frame.
 */
export function InteractiveOutputFrame({
  item,
}: {
  item: RenderOutputPlotlyItem | RenderOutputWidgetItem;
}) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const componentId = useId();
  const requestSeqRef = useRef(0);
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });

  // Computed synchronously alongside `item` (not in an effect), and doubles
  // as the iframe's React `key` below. Keying the iframe by request forces a
  // full remount whenever `item` changes: reusing the same DOM node would
  // leave the framed document's one-shot "renderer-ready" already consumed,
  // so it would never fire again for the new request and nothing would ever
  // be posted to it (docs/rendering-review.md finding 3). A fresh DOM node
  // loads a fresh document, which always emits its own "renderer-ready".
  const [validated, requestId] = useMemo<[ValidationResult<ValidatedRequest>, string]>(() => {
    requestSeqRef.current += 1;
    const id = `${componentId}-${requestSeqRef.current}`;
    if (item.kind === "plotly") {
      const result = validatePlotlySpec(item.spec);
      return [result.ok ? { ok: true, value: { kind: "plotly", spec: result.value } } : result, id];
    }
    const result = validateWidgetPayload(item.view, item.state);
    return [
      result.ok
        ? { ok: true, value: { kind: "widget", view: result.value.view, state: result.value.state } }
        : result,
      id,
    ];
  }, [item, componentId]);

  useEffect(() => {
    setLoadState({ status: "loading" });
  }, [requestId]);

  useEffect(() => {
    if (!validated.ok || loadState.status !== "loading") {
      return;
    }

    const iframe = iframeRef.current;
    if (!iframe) {
      return;
    }

    let settled = false;
    // Latched once the payload has been posted so that a repeated
    // "renderer-ready" (e.g. from a frame that self-navigated after the
    // real renderer loaded) can never trigger a second send of this
    // notebook's data to whatever document now occupies that frame.
    let payloadSent = false;

    const timeoutHandle = window.setTimeout(() => {
      if (!settled) {
        settled = true;
        setLoadState({ status: "timeout" });
      }
    }, RENDER_TIMEOUT_MS);

    function handleMessage(event: MessageEvent) {
      // The iframe has an opaque origin (sandbox="allow-scripts" without
      // allow-same-origin), so `event.origin` is always the literal string
      // "null". Identity of the source window is the only reliable check.
      if (event.source !== iframe?.contentWindow) {
        return;
      }
      if (!isRendererStatusMessage(event.data)) {
        return;
      }
      const message = event.data;
      if (message.type === "renderer-ready") {
        if (!validated.ok || payloadSent) {
          return;
        }
        payloadSent = true;
        const outbound: RendererInboundMessage =
          validated.value.kind === "plotly"
            ? {
                channel: INTERACTIVE_RENDERER_CHANNEL,
                type: "render-plotly",
                requestId,
                spec: validated.value.spec,
              }
            : {
                channel: INTERACTIVE_RENDERER_CHANNEL,
                type: "render-widget",
                requestId,
                view: validated.value.view,
                state: validated.value.state,
              };
        iframe?.contentWindow?.postMessage(outbound, "*");
        return;
      }
      if ("requestId" in message && message.requestId !== requestId) {
        return;
      }
      if (settled) {
        return;
      }
      if (message.type === "render-complete") {
        settled = true;
        window.clearTimeout(timeoutHandle);
        const bounded = Math.min(Math.max(message.height, MIN_FRAME_HEIGHT), MAX_FRAME_HEIGHT);
        setLoadState({ status: "ready", height: bounded });
        return;
      }
      if (message.type === "render-unsupported") {
        settled = true;
        window.clearTimeout(timeoutHandle);
        setLoadState({ status: "unsupported", message: message.reason });
        return;
      }
      if (message.type === "render-error") {
        settled = true;
        window.clearTimeout(timeoutHandle);
        setLoadState({ status: "error", message: message.reason });
      }
    }

    window.addEventListener("message", handleMessage);
    return () => {
      window.clearTimeout(timeoutHandle);
      window.removeEventListener("message", handleMessage);
    };
  }, [validated, loadState.status, requestId]);

  if (!validated.ok) {
    return <InteractiveOutputNotice tone="warning">Rejected: {validated.message}</InteractiveOutputNotice>;
  }
  if (loadState.status === "unsupported") {
    return <InteractiveOutputNotice tone="default">Not embedded: {loadState.message}</InteractiveOutputNotice>;
  }
  if (loadState.status === "error") {
    return <InteractiveOutputNotice tone="warning">Could not render: {loadState.message}</InteractiveOutputNotice>;
  }
  if (loadState.status === "timeout") {
    return (
      <InteractiveOutputNotice tone="warning">
        The interactive renderer did not respond in time.
      </InteractiveOutputNotice>
    );
  }

  return (
    <div className="interactive-output-frame-shell">
      <iframe
        className="interactive-output-frame"
        height={loadState.status === "ready" ? loadState.height : MIN_FRAME_HEIGHT}
        key={requestId}
        ref={iframeRef}
        referrerPolicy="no-referrer"
        sandbox="allow-scripts"
        src={RENDERER_SRC}
        title={item.kind === "plotly" ? "Interactive Plotly figure" : "Saved ipywidgets widget"}
        width="100%"
      />
      {loadState.status === "loading" ? <p className="muted-copy">Loading interactive output…</p> : null}
    </div>
  );
}

function InteractiveOutputNotice({
  tone,
  children,
}: {
  tone: "default" | "warning";
  children: React.ReactNode;
}) {
  return <p className={`interactive-output-notice interactive-output-notice-${tone}`}>{children}</p>;
}
