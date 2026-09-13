import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ApiRequestError, postApi } from "@/lib/api";
import { POST as create } from "@/app/actions/threads/create/route";
import { POST as reply } from "@/app/actions/threads/reply/route";
import { POST as resolve } from "@/app/actions/threads/resolve/route";
import { POST as reopen } from "@/app/actions/threads/reopen/route";

vi.mock("@/lib/api", () => ({
  postApi: vi.fn(),
  ApiRequestError: class extends Error {
    constructor(public status: number, public detail: string) { super(detail); }
  },
}));

const returnTo = "/reviews/example/notebooks/pulls/7/snapshots/1#block-source";
const anchor = { notebook_path: "example.ipynb", block_kind: "source", base_index: 0, head_index: 0 };
const fields = { returnTo, reviewId: "review-id", snapshotId: "snapshot-id", threadId: "thread-id", bodyMarkdown: "A synthetic comment", anchorJson: JSON.stringify(anchor) };
function request(overrides: Record<string, string> = {}, json = true) {
  return new NextRequest("http://0.0.0.0:3000/actions/threads/create", {
    method: "POST", headers: { Accept: json ? "application/json" : "text/html", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...fields, ...overrides }),
  });
}

beforeEach(() => { vi.mocked(postApi).mockReset(); });

describe("thread action route boundary", () => {
  it.each([
    ["create", create, "/api/reviews/review-id/threads", { snapshot_id: "snapshot-id", anchor, body_markdown: fields.bodyMarkdown }],
    ["reply", reply, "/api/threads/thread-id/messages", { body_markdown: fields.bodyMarkdown }],
    ["resolve", resolve, "/api/threads/thread-id/resolve", undefined],
    ["reopen", reopen, "/api/threads/thread-id/reopen", undefined],
  ] as const)("submits %s to the API and returns a safe relative destination", async (_, handler, path, body) => {
    const response = await handler(request());
    expect(postApi).toHaveBeenCalledWith(path, body);
    expect(response.status).toBe(200);
    const data = await response.json() as { ok: boolean; redirectTo: string };
    expect(data.ok).toBe(true);
    expect(data.redirectTo).toMatch(/^\/reviews\/example\/notebooks\/pulls\/7\/snapshots\/1\?flash=success/);
    expect(data.redirectTo).toMatch(/#block-source$/);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it.each([create, reply, resolve, reopen])("never leaks the internal container origin in native form redirects", async (handler) => {
    const response = await handler(request({}, false));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toMatch(/^\/reviews\//);
    expect(response.headers.get("location")).not.toContain("0.0.0.0");
  });

  it.each([401, 403, 404, 409, 422, 500, 502])("preserves API failure %s for an enhanced form", async (status) => {
    vi.mocked(postApi).mockRejectedValue(new ApiRequestError(status, "Synthetic API failure"));
    const response = await create(request());
    expect(response.status).toBe(status);
    const data = await response.json() as { ok: boolean; message: string; loginHref?: string };
    expect(data).toMatchObject({ ok: false, message: "Synthetic API failure" });
    if (status === 401) expect(data.loginHref).toMatch(/^\/api\/auth\/github\/login\?/);
    else expect(data.loginHref).toBeUndefined();
    expect(response.headers.get("location")).toBeNull();
  });

  it.each([create, reply])("validates blank comments before sending any API mutation", async (handler) => {
    const response = await handler(request({ bodyMarkdown: " \n " }));
    expect(response.status).toBe(400);
    expect(postApi).not.toHaveBeenCalled();
  });

  it("returns malformed anchors as recoverable errors, including native relative redirect", async () => {
    expect((await create(request({ anchorJson: "bad-json" }))).status).toBe(400);
    const response = await create(request({ anchorJson: "bad-json" }, false));
    expect(response.headers.get("location")).toMatch(/^\/reviews\/.*flash=error/);
    expect(postApi).not.toHaveBeenCalled();
  });

  it("validates missing identity fields and malformed form bodies", async () => {
    expect((await reply(request({ threadId: "" }))).status).toBe(400);
    const response = await create(new NextRequest("http://internal.test/actions", { method: "POST", headers: { Accept: "application/json", "Content-Type": "text/plain" }, body: "not a form" }));
    expect(response.status).toBe(400);
    expect(postApi).not.toHaveBeenCalled();
  });

  it("keeps unauthorized native login redirects relative and sanitizes return URLs", async () => {
    vi.mocked(postApi).mockRejectedValue(new ApiRequestError(401, "Sign in required"));
    const response = await create(request({ returnTo: "//external.example/" }, false));
    expect(response.headers.get("location")).toBe("/api/auth/github/login?next_path=%2F");
  });

  it("does not expose unexpected internal exception details", async () => {
    vi.mocked(postApi).mockRejectedValue(new Error("internal-secret-marker"));
    const response = await create(request());
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("internal-secret-marker");
  });
});
