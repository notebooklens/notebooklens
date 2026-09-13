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
  postApi,
} from "@/lib/api";


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
});
