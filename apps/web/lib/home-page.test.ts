import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import HomePage from "../app/page";


vi.stubGlobal("React", React);

const WORKSPACE_QUICKSTART_URL =
  "https://notebooklens.github.io/notebooklens/quickstart-workspace/";

async function renderHomePage(
  searchParams: Record<string, string | string[] | undefined> = {},
) {
  return renderToStaticMarkup(
    await HomePage({ searchParams: Promise.resolve(searchParams) }),
  );
}


describe("HomePage", () => {
  it("keeps the landing path singular with one GitHub-first primary action", async () => {
    const html = await renderHomePage();
    const primaryButtons = html.match(/class="primary-button"/g) ?? [];
    const secondaryButtons = html.match(/class="secondary-button"/g) ?? [];

    expect(html).toContain("Next step");
    expect(html).toContain("Continue with GitHub");
    expect(html).toContain(
      "Open changed cells, outputs, and inline comments",
    );
    expect(html).toContain(
      "Open changed cells, outputs, and inline comments for the notebook pull request you need to review.",
    );
    expect(html).toContain(
      'href="/api/auth/github/login?next_path=%2F"',
    );
    expect(primaryButtons).toHaveLength(1);
    expect(secondaryButtons).toHaveLength(0);
    expect(html.indexOf("Continue with GitHub")).toBeLessThan(
      html.indexOf("What reviewers actually open"),
    );
    expect(html).toContain("The one-time repository setup lives in the");
    expect(html).toContain("Keep setup details in one place");
    expect(html).not.toContain("Need setup first?");
    expect(html).not.toContain("Install the GitHub App review flow");
  });

  it("switches the same primary CTA to the setup reference after GitHub app install returns home", async () => {
    const html = await renderHomePage({
      installation_id: "123",
      setup_action: "install",
    });

    expect(html).toContain("Open changed cells, outputs, and inline comments");
    expect(html).toContain(
      "Use the workspace quick start to open a notebook pull request review with changed cells, rendered outputs, and inline comments already in view.",
    );
    expect(html).toContain(`href="${WORKSPACE_QUICKSTART_URL}"`);
    expect(html).toContain("Open workspace quick start");
    expect(html).not.toContain(
      'href="/api/auth/github/login?next_path=%2F"',
    );
  });

  it("marks the reviewer proof panel as an anchored illustration instead of a detached example thread", async () => {
    const html = await renderHomePage();
    const statusPills = html.match(/class="status-pill/g) ?? [];

    expect(html).toContain("Illustration only");
    expect(html).toContain("Static preview of the latest notebook review workspace");
    expect(html).toContain(
      "Status: latest push ready with changed cells, outputs, and 1 open inline comment in view.",
    );
    expect(html).toContain("Review target");
    expect(html).toContain(
      "sales_forecast.ipynb · changed output plot + markdown diff",
    );
    expect(html).toContain("Next action");
    expect(html).toContain("Open latest push review");
    expect(statusPills).toHaveLength(0);
    expect(html).toContain("Changed output");
    expect(html).toContain("thread anchored here");
    expect(html).toContain("Open thread");
    expect(html).toContain(
      "Attached directly to this changed output before replying on the pull request.",
    );
    expect(html).not.toContain("Example inline comment");
    expect(html).not.toContain("reviewing latest push");
  });
});
