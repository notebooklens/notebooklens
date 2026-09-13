import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ReviewRoute } from "../components/review-route";
import { ApiRequestError } from "@/lib/api";


vi.stubGlobal("React", React);

const apiMocks = vi.hoisted(() => ({
  buildLoginHref: vi.fn(
    (path: string) =>
      `https://notebooklens.test/api/auth/github/login?next_path=${encodeURIComponent(path)}`,
  ),
  getReviewWorkspace: vi.fn(),
  getSnapshotWorkspace: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
  }) => React.createElement("a", { href, ...props }, children),
}));

vi.mock("@/components/review-workspace", () => ({
  ReviewWorkspace: () => React.createElement("div", null, "workspace"),
}));

vi.mock("@/lib/review-workspace", () => ({
  readFlashNotice: vi.fn(() => null),
}));

vi.mock("@/lib/api", () => {
  class ApiRequestError extends Error {
    status: number;
    detail: string;

    constructor(status: number, detail: string) {
      super(detail);
      this.name = "ApiRequestError";
      this.status = status;
      this.detail = detail;
    }
  }

  return {
    ApiRequestError,
    buildLoginHref: apiMocks.buildLoginHref,
    getReviewWorkspace: apiMocks.getReviewWorkspace,
    getSnapshotWorkspace: apiMocks.getSnapshotWorkspace,
  };
});


async function renderRoute(props: Parameters<typeof ReviewRoute>[0]) {
  return renderToStaticMarkup(await ReviewRoute(props));
}


beforeEach(() => {
  apiMocks.buildLoginHref.mockClear();
  apiMocks.getReviewWorkspace.mockReset();
  apiMocks.getSnapshotWorkspace.mockReset();
});


describe("ReviewRoute", () => {
  it("renders a review-first auth interstitial for the latest review route", async () => {
    apiMocks.getReviewWorkspace.mockRejectedValue(
      new ApiRequestError(401, "Unauthorized"),
    );

    const html = await renderRoute({
      currentPath: "/reviews/octo-org/notebooklens/pulls/7",
      owner: "octo-org",
      pullNumber: 7,
      repo: "notebooklens",
      searchParams: {},
    });

    expect(apiMocks.getReviewWorkspace).toHaveBeenCalledWith(
      "octo-org",
      "notebooklens",
      7,
    );
    expect(html).toContain("octo-org/notebooklens · PR #7");
    expect(html).toContain("NotebookLens review workspace");
    expect(html).toContain("Sign-in required");
    expect(html).toContain(
      "Open changed cells, outputs, and inline comments for this PR.",
    );
    expect(html).toContain(
      "Changed cells, outputs, and inline comments stay front and center",
    );
    expect(html).toContain("Continue to octo-org/notebooklens · PR #7");
    expect(html).toContain("Cells, outputs, and inline comments");
    expect(html).not.toContain(
      "Use the GitHub account that can already open octo-org/notebooklens.",
    );
    expect(html).not.toContain(
      "Make sure the NotebookLens GitHub App is installed on this repository.",
    );
    expect(html).toContain(
      "next_path=%2Freviews%2Focto-org%2Fnotebooklens%2Fpulls%2F7",
    );
  });

  it("keeps snapshot identity visible in the auth interstitial for saved-push routes", async () => {
    apiMocks.getSnapshotWorkspace.mockRejectedValue(
      new ApiRequestError(401, "Unauthorized"),
    );

    const html = await renderRoute({
      currentPath: "/reviews/octo-org/notebooklens/pulls/7/snapshots/3",
      owner: "octo-org",
      pullNumber: 7,
      repo: "notebooklens",
      searchParams: {},
      snapshotIndex: 3,
    });

    expect(apiMocks.getSnapshotWorkspace).toHaveBeenCalledWith(
      "octo-org",
      "notebooklens",
      7,
      3,
    );
    expect(html).toContain("octo-org/notebooklens · PR #7 · Push 3");
    expect(html).toContain("Push 3 snapshot");
    expect(html).toContain(
      "Continue to octo-org/notebooklens · PR #7 · Push 3",
    );
    expect(html).toContain(
      "next_path=%2Freviews%2Focto-org%2Fnotebooklens%2Fpulls%2F7%2Fsnapshots%2F3",
    );
  });
});
