import { afterEach, describe, expect, it, vi } from "vitest";
import { cookies } from "next/headers";


vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));


import {
  ApiConfigurationError,
  buildApiHref,
  buildLoginHref,
  getReviewWorkspace,
  getSnapshotWorkspace,
  postApi,
} from "@/lib/api";
import serializedThread from "./fixtures/serialized_thread.json";
import { summarizeGitHubMirrorStatus } from "@/lib/review-workspace";


describe("api url helpers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses the configured public APP_BASE_URL for login links", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_BASE_URL", "https://notebooklens.example/");

    expect(buildLoginHref("/reviews/demo")).toBe(
      "https://notebooklens.example/api/auth/github/login?next_path=%2Freviews%2Fdemo",
    );
  });

  it("keeps the localhost api fallback for local development", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("APP_BASE_URL", "");

    expect(buildApiHref("/api/healthz")).toBe("http://127.0.0.1:8000/api/healthz");
  });

  it("fails safely instead of emitting localhost links in production when APP_BASE_URL is missing", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_BASE_URL", "");

    expect(() => buildLoginHref("/")).toThrowError(ApiConfigurationError);
    expect(() => buildLoginHref("/")).toThrowError(
      "APP_BASE_URL is required in production",
    );
  });

  it("rejects loopback APP_BASE_URL values in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_BASE_URL", "http://127.0.0.1:8000");

    expect(() => buildLoginHref("/")).toThrowError(
      "APP_BASE_URL must be a public http(s) origin in production",
    );
  });

  it("rejects APP_BASE_URL values with a path", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_BASE_URL", "https://notebooklens.example/reviews");

    expect(() => buildApiHref("/api/healthz")).toThrowError(
      "APP_BASE_URL must be an origin without a path, query, or fragment",
    );
  });
});

describe("API request cookie forwarding", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  it("forwards synthetic sessions from mutable stores without size or Set-Cookie attributes", async () => {
    vi.stubEnv("APP_BASE_URL", "https://notebooklens.example");
    const getAll = () => [{ name: "notebooklens_session", value: "synthetic-session" }, { name: "synthetic_note", value: "a b;c" }];
    // Real Next action/route stores use ResponseCookies: no size property.
    vi.mocked(cookies).mockResolvedValue({ getAll, toString: () => "must-not-forward; Path=/" } as unknown as Awaited<ReturnType<typeof cookies>>);
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response("{}", { headers: { "Content-Type": "application/json" } })));
    vi.stubGlobal("fetch", fetchMock);
    await postApi("/api/reviews/synthetic/threads", { body_markdown: "Synthetic comment" });
    await getReviewWorkspace("example", "notebooks", 7);
    for (const call of fetchMock.mock.calls) {
      expect((call[1] as RequestInit).headers).toMatchObject({ Cookie: "notebooklens_session=synthetic-session; synthetic_note=a%20b%3Bc" });
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not invent an authentication cookie for an empty store", async () => {
    vi.stubEnv("APP_BASE_URL", "https://notebooklens.example");
    vi.mocked(cookies).mockResolvedValue({ getAll: () => [] } as unknown as Awaited<ReturnType<typeof cookies>>);
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    await postApi("/api/threads/synthetic/resolve");
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).not.toHaveProperty("Cookie");
  });

  it("normalizes the real backend serializer contract for latest and historical routes", async () => {
    vi.stubEnv("APP_BASE_URL", "https://notebooklens.example");
    vi.mocked(cookies).mockResolvedValue({ getAll: () => [] } as unknown as Awaited<ReturnType<typeof cookies>>);
    // Python test_workspace_contract validates this entire shared fixture against
    // serialize_thread(), preventing independent fixture-shape drift.
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({
      review: {}, snapshot: null, threads: [serializedThread],
    }), { headers: { "Content-Type": "application/json" } })));
    vi.stubGlobal("fetch", fetchMock);
    for (const payload of [await getReviewWorkspace("example", "notebooks", 1), await getSnapshotWorkspace("example", "notebooks", 1, 1)]) {
      const thread = payload.threads[0];
      expect(thread.github_mirror_state).toBe("mirrored");
      expect(thread.github_root_comment_url).toBe(serializedThread.github_mirror.root_comment_url);
      expect(thread.github_root_comment_id).toBe(123);
      expect(thread.github_last_mirrored_at).toBe(serializedThread.github_mirror.last_mirrored_at);
      expect(summarizeGitHubMirrorStatus(thread)).toMatchObject({ label: "Posted", linkLabel: "Open mirrored PR thread" });
      expect(summarizeGitHubMirrorStatus(thread).description).toContain("native conversation is not resolved automatically");
    }
  });

  it.each([
    ["pending", "Posting pending"], ["failed", "Posting failed"],
    ["skipped", "Posting skipped"], [null, "Posting status unavailable"],
  ])("preserves nested %s state and explicit nulls over stale flat values", async (state, label) => {
    vi.stubEnv("APP_BASE_URL", "https://notebooklens.example");
    vi.mocked(cookies).mockResolvedValue({ getAll: () => [] } as unknown as Awaited<ReturnType<typeof cookies>>);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      review: {}, snapshot: null, threads: [{
        ...serializedThread, github_mirror_state: "mirrored", github_root_comment_url: "https://github.example.test/stale",
        github_mirror: { ...serializedThread.github_mirror, state, root_comment_url: null },
      }],
    }), { headers: { "Content-Type": "application/json" } })));
    const thread = (await getReviewWorkspace("example", "notebooks", 1)).threads[0];
    expect(thread.github_mirror_state).toBe(state);
    expect(thread.github_root_comment_url).toBeNull();
    expect(summarizeGitHubMirrorStatus(thread).label).toBe(label);
  });
});
