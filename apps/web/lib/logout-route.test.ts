import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { postLogout } from "@/lib/api";
import { POST } from "@/app/actions/auth/logout/route";
vi.mock("@/lib/api", () => ({ postLogout: vi.fn(), ApiRequestError: class extends Error {} }));
beforeEach(() => { vi.mocked(postLogout).mockReset(); });
it("signs out to the homepage, not an internal origin or immediate OAuth loop", async () => {
  const response = await POST(new NextRequest("http://0.0.0.0:3000/actions/auth/logout", { method: "POST", body: new URLSearchParams({ returnTo: "/" }) }));
  expect(postLogout).toHaveBeenCalledOnce();
  expect(response.headers.get("location")).toBe("/");
});
it("reports sign-out failure without an external redirect or exception leak", async () => {
  vi.mocked(postLogout).mockRejectedValue(new Error("private-marker"));
  const response = await POST(new NextRequest("http://0.0.0.0:3000/actions/auth/logout", { method: "POST", body: new URLSearchParams({ returnTo: "//external.example/" }) }));
  expect(response.headers.get("location")).toMatch(/^\/\?flash=error/);
  expect(response.headers.get("location")).not.toContain("private-marker");
});
