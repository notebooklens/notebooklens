import { NextRequest, NextResponse } from "next/server";

import { ApiRequestError, buildLoginHref, postApi } from "@/lib/api";
import { buildFlashRedirect } from "@/lib/review-workspace";


export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const returnTo = requiredField(formData, "returnTo");
  const threadId = requiredField(formData, "threadId");

  try {
    await postApi(`/api/threads/${threadId}/reopen`);
  } catch (error) {
    return handleMutationError(request, returnTo, error);
  }

  return redirectWithFlash(request, returnTo, "success", "Thread reopened.");
}


function requiredField(formData: FormData, key: string): string {
  const value = formData.get(key);
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing required form field: ${key}`);
  }
  return value.trim();
}


function handleMutationError(request: NextRequest, returnTo: string, error: unknown) {
  if (error instanceof ApiRequestError && error.status === 401) {
    return NextResponse.redirect(new URL(buildLoginHref(returnTo)), { status: 303 });
  }

  const detail =
    error instanceof ApiRequestError
      ? error.detail
      : "NotebookLens could not complete that action.";
  return redirectWithFlash(request, returnTo, "error", detail);
}


function redirectWithFlash(
  request: NextRequest,
  returnTo: string,
  tone: "success" | "error",
  message: string,
) {
  return NextResponse.redirect(
    new URL(buildFlashRedirect(returnTo, { tone, message }), request.nextUrl.origin),
    { status: 303 },
  );
}
