import { NextRequest, NextResponse } from "next/server";
import { ApiRequestError, postLogout } from "@/lib/api";
import { buildFlashRedirect, sanitizeWorkspaceReturnTo } from "@/lib/review-workspace";

export async function POST(request: NextRequest) {
  const data = await request.formData();
  const value = data.get("returnTo");
  const returnTo = sanitizeWorkspaceReturnTo(typeof value === "string" ? value : "/");
  let destination = "/";
  try {
    await postLogout();
  } catch (error) {
    if (!(error instanceof ApiRequestError && error.status === 401)) {
      destination = buildFlashRedirect(returnTo, { tone: "error", message: "NotebookLens could not sign you out. Please try again." });
    }
  }
  return new NextResponse(null, { status: 303, headers: { Location: destination, "Cache-Control": "no-store" } });
}
