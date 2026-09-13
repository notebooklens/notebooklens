import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(() => { throw new Error("redirect"); }) }));
vi.mock("@/lib/api", () => ({
  ApiRequestError: class extends Error {
    constructor(public status: number, public detail: string) { super(detail); }
  },
  buildLoginHref: vi.fn((nextPath: string) => `/login?next_path=${encodeURIComponent(nextPath)}`),
  postApi: vi.fn(), postApiJson: vi.fn(), postLogout: vi.fn(), putApiJson: vi.fn(),
}));

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ApiRequestError, buildLoginHref, postApi } from "@/lib/api";
import { createThreadAction, replyToThreadAction, resolveThreadAction, reopenThreadAction } from "@/lib/actions";

function form(returnTo: string): FormData {
  const values = new FormData();
  for (const [key, value] of Object.entries({ returnTo, reviewId: "review-1", snapshotId: "snapshot-1", threadId: "thread-1", bodyMarkdown: "Test comment", anchorJson: "{}" })) values.set(key, value);
  return values;
}

describe("thread server action return paths", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(postApi).mockResolvedValue(undefined); });

  it.each([createThreadAction, replyToThreadAction, resolveThreadAction, reopenThreadAction])("invalidates pathname only while preserving the redirected discussion fragment (%s)", async (action) => {
    await expect(action(form("/reviews/demo?push=2#thread-1"))).rejects.toThrow("redirect");
    expect(revalidatePath).toHaveBeenCalledExactlyOnceWith("/reviews/demo");
    expect(redirect).toHaveBeenCalledTimes(1);
    const destination = vi.mocked(redirect).mock.calls[0][0];
    expect(destination).toContain("/reviews/demo?push=2&flash=success&message=");
    expect(destination).toMatch(/#thread-1$/);
  });

  it("rejects normalized protocol-relative paths for invalidation and redirects", async () => {
    await expect(resolveThreadAction(form("/a/..//evil.example/path#thread"))).rejects.toThrow("redirect");
    expect(revalidatePath).toHaveBeenCalledExactlyOnceWith("/");
    expect(redirect).toHaveBeenCalledExactlyOnceWith("/?flash=success&message=Thread+resolved.");
  });

  it("sanitizes login return targets on authorization failure without invalidating", async () => {
    vi.mocked(postApi).mockRejectedValueOnce(new ApiRequestError(401, "Sign in"));
    await expect(replyToThreadAction(form("https://evil.example/path"))).rejects.toThrow("redirect");
    expect(buildLoginHref).toHaveBeenCalledExactlyOnceWith("/");
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("retains the local discussion target through a fresh login", async () => {
    vi.mocked(postApi).mockRejectedValueOnce(new ApiRequestError(401, "Sign in"));
    await expect(replyToThreadAction(form("/reviews/demo?push=2#thread-1"))).rejects.toThrow("redirect");
    expect(buildLoginHref).toHaveBeenCalledExactlyOnceWith("/reviews/demo?push=2#thread-1");
  });
});
