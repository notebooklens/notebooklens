import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import HomePage from "../app/page";
import { ApiRequestError, getRepositories, getSessionIdentity } from "@/lib/api";

vi.stubGlobal("React", React);
vi.mock("@/lib/api", () => ({
  getRepositories: vi.fn(), getSessionIdentity: vi.fn(),
  ApiRequestError: class extends Error { constructor(public status: number, public detail: string) { super(detail); } },
}));
async function render(params: Record<string, string> = {}) {
  return renderToStaticMarkup(await HomePage({ searchParams: Promise.resolve(params) }));
}
beforeEach(() => {
  vi.mocked(getSessionIdentity).mockReset();
  vi.mocked(getRepositories).mockReset();
});

describe("session-aware homepage", () => {
  it("shows a compact sign-in view only after API rejects the session", async () => {
    vi.mocked(getSessionIdentity).mockRejectedValue(new ApiRequestError(401, "Authentication required"));
    const html = await render();
    expect(html).toContain("Continue with GitHub");
    expect(html).toContain('href="/api/auth/github/login?next_path=%2F"');
    expect(html).not.toContain("Illustration only");
    expect(getRepositories).not.toHaveBeenCalled();
    expect(html).toContain("Settings</summary>");
    expect(html).not.toContain("Sign out");
    expect(html).not.toContain("Open team AI settings");
  });
  it("renders authorized repositories for a verified identity without a login loop", async () => {
    vi.mocked(getSessionIdentity).mockResolvedValue({ user: { id: 101, login: "synthetic-reviewer" } });
    vi.mocked(getRepositories).mockResolvedValue({ repositories: [{ id: "repo1", owner: "example", name: "notebooks", full_name: "example/notebooks", reviews: [{ id: "review1", pull_number: 7, status: "ready", href: "/reviews/example/notebooks/pulls/7" }] }], next_cursor: "opaque-next" });
    const html = await render({ cursor: "opaque-current" });
    expect(getRepositories).toHaveBeenCalledWith("opaque-current");
    expect(html).toContain("Signed in as synthetic-reviewer");
    expect(html).toContain("example/notebooks");
    expect(html).toContain("Select a repository");
    expect(html).toContain("Next repositories");
    expect(html).not.toContain("Continue with GitHub");
    expect(html).toContain("Sign out");
    expect(html).not.toContain("Open team AI settings");
  });
  it("keeps the empty authorized list honest and does not invent repositories", async () => {
    vi.mocked(getSessionIdentity).mockResolvedValue({ user: { id: 101, login: "synthetic-reviewer" } });
    vi.mocked(getRepositories).mockResolvedValue({ repositories: [], next_cursor: null });
    expect(await render()).toContain("No accessible repositories on this page.");
  });
  it("does not treat upstream failures as a logout or expose internal error details", async () => {
    vi.mocked(getSessionIdentity).mockRejectedValue(new Error("private-marker"));
    const html = await render();
    expect(html).toContain("Could not load your repositories");
    expect(html).not.toContain("Continue with GitHub");
    expect(html).not.toContain("private-marker");
    expect(html).not.toContain("Sign out");
    expect(html).toContain("Go to Home to check access");
  });
  it("handles session expiration during the repository request", async () => {
    vi.mocked(getSessionIdentity).mockResolvedValue({ user: { id: 101, login: "synthetic-reviewer" } });
    vi.mocked(getRepositories).mockRejectedValue(new ApiRequestError(401, "Session expired"));
    const html = await render();
    expect(html).toContain("Continue with GitHub");
    expect(html).not.toContain("Signed in as");
  });
  it("retains verified identity when repository loading fails without rejecting authentication", async () => {
    vi.mocked(getSessionIdentity).mockResolvedValue({ user: { id: 101, login: "synthetic-reviewer" } });
    vi.mocked(getRepositories).mockRejectedValue(new ApiRequestError(502, "private-marker"));
    const html = await render();
    expect(html).toContain("Signed in as synthetic-reviewer");
    expect(html).toContain("Sign out");
    expect(html).toContain("Could not load your repositories");
    expect(html).not.toContain("private-marker");
    expect(html).not.toContain("Open team AI settings");
  });
});
