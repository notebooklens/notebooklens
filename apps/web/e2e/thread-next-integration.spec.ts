import { test, expect } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { cp, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildRow, buildThread, buildWorkspace } from "./workspace-fixture";

// Explicit opt-in: real Next/RSC, synthetic HTTP API, no real sessions or providers.
// A private source copy prevents .next/build collisions and excludes all env files.
test("real Next refresh adds the thread and retains other stable-snapshot drafts", async ({ page }, info) => {
  test.skip(process.env.NOTEBOOKLENS_NEXT_INTEGRATION !== "1" || info.project.name !== "chromium", "Optional isolated real-Next integration");
  test.setTimeout(180_000);
  page.setDefaultTimeout(10_000);
  page.setDefaultNavigationTimeout(30_000);
  const root = path.join(__dirname, "..");
  const temporary = await mkdtemp(path.join(tmpdir(), "notebooklens-next-test-"));
  let api: Server | undefined;
  let next: ChildProcess | undefined;
  let serverOutput = "";
  const runtimeErrors: string[] = [];
  const outbound: string[] = [];
  const row = buildRow({ source: { base: "print(1)", head: "print(2)", changed: true }, outputs: { changed: true, items: [
    { kind: "placeholder", side: "head", output_type: "stream", mime_group: "text", summary: "2", change_type: "modified", truncated: false },
  ] } });
  const workspace = buildWorkspace(row);
  workspace.threads = [buildThread(row)];
  let creates = 0;
  let reads = 0;
  let authenticatedReads = 0;
  let authenticatedCreates = 0;
  const syntheticSession = "synthetic-next-session-not-a-real-credential";
  try {
    for (const entry of ["app", "components", "lib", "package.json", "tsconfig.json", "next.config.ts"]) {
      await cp(path.join(root, entry), path.join(temporary, entry), { recursive: true });
    }
    await symlink(path.join(root, "node_modules"), path.join(temporary, "node_modules"), "dir");
    api = createServer((request, response) => { void (async () => {
      response.setHeader("Content-Type", "application/json");
      if (request.url?.startsWith("/api/reviews/") && request.headers.cookie !== `notebooklens_session=${syntheticSession}`) {
        response.writeHead(401).end(JSON.stringify({ detail: "Authentication required" }));
        return;
      }
      if (request.method === "GET" && request.url === "/api/reviews/example/notebooks/pulls/7") {
        reads++;
        authenticatedReads++;
        response.end(JSON.stringify(workspace));
      } else if (request.method === "POST" && request.url === "/api/reviews/review-id/threads") {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk as Uint8Array));
        const body = JSON.parse(Buffer.concat(chunks).toString()) as { anchor: typeof row.thread_anchors.source; body_markdown: string };
        creates++;
        authenticatedCreates++;
        const thread = buildThread(row, { id: "created-thread", anchor: body.anchor, carried_forward: false });
        thread.messages = [{ ...thread.messages[0], id: "created-message", body_markdown: body.body_markdown }];
        workspace.threads.push(thread);
        response.writeHead(201).end(JSON.stringify({ thread }));
      } else response.writeHead(404).end(JSON.stringify({ detail: "Synthetic endpoint not found" }));
    })().catch(() => { response.writeHead(500).end(JSON.stringify({ detail: "Synthetic fixture error" })); }); });
    await new Promise<void>(resolve => api!.listen(0, "127.0.0.1", resolve));
    const address = api.address();
    if (!address || typeof address === "string") throw new Error("Missing synthetic API port");
    const portProbe = createServer();
    await new Promise<void>(resolve => portProbe.listen(0, "127.0.0.1", resolve));
    const nextAddress = portProbe.address();
    if (!nextAddress || typeof nextAddress === "string") throw new Error("Missing Next port");
    await new Promise<void>(resolve => portProbe.close(() => resolve()));
    const origin = `http://127.0.0.1:${nextAddress.port}`;
    next = spawn(process.execPath, [path.join(root, "node_modules/next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", String(nextAddress.port)], {
      cwd: temporary,
      env: { PATH: process.env.PATH, NODE_ENV: "development", NEXT_TELEMETRY_DISABLED: "1", APP_BASE_URL: `http://127.0.0.1:${address.port}` },
      stdio: ["ignore", "pipe", "pipe"],
    });
    next.stdout?.on("data", (chunk: Buffer) => { serverOutput = (serverOutput + chunk.toString()).slice(-6000); });
    next.stderr?.on("data", (chunk: Buffer) => { serverOutput = (serverOutput + chunk.toString()).slice(-6000); });
    console.info("Isolated Next source copied; waiting for local readiness.");
    await expect.poll(async () => {
      if (next!.exitCode !== null) throw new Error(`Isolated Next exited: ${serverOutput.replaceAll(root, "<source>").replaceAll(temporary, "<temporary>")}`);
      try { return (await fetch(origin, { signal: AbortSignal.timeout(3000) })).status; } catch { return 0; }
    }, { timeout: 90_000 }).toBe(200).catch(() => {
      throw new Error(`Isolated Next readiness failed: ${serverOutput.replaceAll(root, "<source>").replaceAll(temporary, "<temporary>")}`);
    });
    console.info("Isolated Next ready; checking real review route.");
    page.on("pageerror", error => runtimeErrors.push(error.message));
    page.on("console", message => { if (message.type() === "error") runtimeErrors.push(message.text()); });
    await page.route("**/*", route => {
      if (new URL(route.request().url()).origin === origin) return route.continue();
      outbound.push("blocked non-local browser request");
      return route.abort();
    });
    await page.context().addCookies([{ name: "notebooklens_session", value: syntheticSession, url: origin, httpOnly: true, sameSite: "Lax" }]);
    await page.goto(`${origin}/reviews/example/notebooks/pulls/7`);
    const changes = page.locator("[data-review-changes]");
    await changes.getByText("Reply", { exact: true }).first().click();
    const reply = changes.getByRole("textbox", { name: "Reply to octo-reviewer" }).first();
    await reply.fill("Unsubmitted reply stays mounted");
    const comment = page.getByRole("textbox", { name: "New discussion comment" });
    await page.getByRole("button", { name: "Add comment on Cell 2 code", exact: true }).click();
    await comment.fill("Created through real Next RSC");
    await page.getByRole("button", { name: "Add comment on Cell 2 outputs", exact: true }).click();
    await comment.fill("Separate output draft survives");
    await page.getByRole("button", { name: "Add comment on Cell 2 code", exact: true }).click();
    await expect(comment).toHaveValue("Created through real Next RSC");
    const readsBefore = reads;
    await page.getByRole("button", { name: "Comment", exact: true }).click();
    await expect(changes.locator(".message-body").getByText("Created through real Next RSC", { exact: true })).toBeVisible();
    expect(reads).toBeGreaterThan(readsBefore);
    expect(creates).toBe(1);
    expect(authenticatedCreates).toBe(1);
    expect(authenticatedReads).toBeGreaterThan(1);
    await expect(comment).toHaveValue("");
    await expect(reply).toHaveValue("Unsubmitted reply stays mounted");
    await page.getByRole("button", { name: "Add comment on Cell 2 outputs", exact: true }).click();
    await expect(comment).toHaveValue("Separate output draft survives");
    await page.getByRole("button", { name: "Add comment on Cell 2 code", exact: true }).click();
    await expect(comment).toHaveValue("");
    expect(new URL(page.url()).origin).toBe(origin);
    expect(runtimeErrors).toEqual([]);
    expect(outbound).toEqual([]);
  } finally {
    if (next && next.exitCode === null) {
      const exited = new Promise<void>(resolve => next!.once("exit", () => resolve()));
      next.kill("SIGTERM");
      const killTimer = setTimeout(() => next!.kill("SIGKILL"), 5000);
      await exited;
      clearTimeout(killTimer);
    }
    if (api) {
      api.closeAllConnections();
      await new Promise<void>(resolve => api!.close(() => resolve()));
    }
    await rm(temporary, { recursive: true, force: true });
  }
});
