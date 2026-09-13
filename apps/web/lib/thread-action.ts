import { NextRequest, NextResponse } from "next/server";

import { ApiRequestError, postApi } from "@/lib/api";
import { buildLoginHref } from "@/lib/public-hrefs";
import { buildFlashRedirect, sanitizeWorkspaceReturnTo } from "@/lib/review-workspace";

type ThreadAction = "create" | "reply" | "resolve" | "reopen";

const successMessages: Record<ThreadAction, string> = {
  create: "Thread created.",
  reply: "Reply added.",
  resolve: "Thread resolved.",
  reopen: "Thread reopened.",
};

class InvalidThreadForm extends Error {}

/** Keep browser redirects relative: Next's internal origin is not the gateway's. */
export async function handleThreadAction(request: NextRequest, action: ThreadAction) {
  const wantsJson = request.headers.get("accept")?.includes("application/json") ?? false;
  let returnTo = "/";
  try {
    let data: FormData;
    try {
      data = await request.formData();
    } catch {
      throw new InvalidThreadForm("NotebookLens could not read the submitted form.");
    }
    returnTo = sanitizeWorkspaceReturnTo(requiredField(data, "returnTo"));
    if (action === "create") {
      const reviewId = encodeURIComponent(requiredField(data, "reviewId"));
      const snapshotId = requiredField(data, "snapshotId");
      const bodyMarkdown = requiredField(data, "bodyMarkdown");
      let anchor: unknown;
      try {
        anchor = JSON.parse(requiredField(data, "anchorJson")) as unknown;
      } catch {
        throw new InvalidThreadForm("NotebookLens could not parse the selected thread anchor.");
      }
      await postApi(`/api/reviews/${reviewId}/threads`, {
        snapshot_id: snapshotId,
        anchor,
        body_markdown: bodyMarkdown,
      });
    } else {
      const threadId = encodeURIComponent(requiredField(data, "threadId"));
      await postApi(
        `/api/threads/${threadId}/${action === "reply" ? "messages" : action}`,
        action === "reply" ? { body_markdown: requiredField(data, "bodyMarkdown") } : undefined,
      );
    }
    const message = successMessages[action];
    const redirectTo = buildFlashRedirect(returnTo, { tone: "success", message });
    return wantsJson
      ? NextResponse.json({ ok: true, message, redirectTo }, { headers: { "Cache-Control": "no-store" } })
      : relativeRedirect(redirectTo);
  } catch (error) {
    const status = error instanceof InvalidThreadForm ? 400 : error instanceof ApiRequestError ? error.status : 502;
    const message = error instanceof InvalidThreadForm || error instanceof ApiRequestError
      ? error.message
      : "NotebookLens could not complete that action. Your draft has been kept; try again.";
    const loginHref = status === 401 ? buildLoginHref(returnTo) : undefined;
    if (wantsJson) {
      return NextResponse.json({ ok: false, message, ...(loginHref ? { loginHref } : {}) }, {
        status,
        headers: { "Cache-Control": "no-store" },
      });
    }
    return relativeRedirect(loginHref ?? buildFlashRedirect(returnTo, { tone: "error", message }));
  }
}

function requiredField(data: FormData, key: string): string {
  const value = data.get(key);
  if (typeof value !== "string" || !value.trim()) {
    throw new InvalidThreadForm(key === "bodyMarkdown" ? "Write a comment before submitting." : `Missing required form field: ${key}`);
  }
  return value.trim();
}

function relativeRedirect(path: string) {
  return new NextResponse(null, { status: 303, headers: { Location: path, "Cache-Control": "no-store" } });
}
