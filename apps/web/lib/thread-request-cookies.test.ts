import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { POST as create } from "@/app/actions/threads/create/route";
import { POST as reply } from "@/app/actions/threads/reply/route";
import { POST as resolve } from "@/app/actions/threads/resolve/route";
import { POST as reopen } from "@/app/actions/threads/reopen/route";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));

beforeEach(() => {
  vi.stubEnv("APP_BASE_URL", "https://api.example");
  vi.mocked(cookies).mockImplementation(() => { throw new Error("cookies called outside request scope"); });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

function request(cookie?: string) {
  return new NextRequest("https://workspace.example/actions/threads/create", {
    method: "POST",
    headers: { Accept: "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: new URLSearchParams({ returnTo: "/reviews/example/notebooks/pulls/7", reviewId: "review-id", snapshotId: "snapshot-id", threadId: "thread-id", bodyMarkdown: "Synthetic comment", anchorJson: "{}" }),
  });
}

describe("actual thread routes use explicit request cookies", () => {
  it.each([create, reply, resolve, reopen])("forwards multiple request cookies without consulting unavailable ambient state", async handler => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await handler(request("notebooklens_session=synthetic%20session; preference=compact"));
    expect(response.status).toBe(200);
    expect(cookies).not.toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.origin).toBe("https://api.example");
    expect(new Headers(init.headers).get("cookie")).toBe("notebooklens_session=synthetic%20session; preference=compact");
  });

  it("keeps an explicitly empty request unauthenticated and returns the API's 401", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: "Authentication required" }), { status: 401, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await create(request());
    expect(response.status).toBe(401);
    expect(cookies).not.toHaveBeenCalled();
    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(new Headers(init.headers).has("cookie")).toBe(false);
    const result = await response.json() as { ok: boolean; loginHref: string };
    expect(result.ok).toBe(false);
    expect(result.loginHref).toContain("/api/auth/github/login?");
  });
});
