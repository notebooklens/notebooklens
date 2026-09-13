import { afterEach, describe, expect, it, vi } from "vitest";


vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));


import {
  ApiConfigurationError,
  buildApiHref,
  buildLoginHref,
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
