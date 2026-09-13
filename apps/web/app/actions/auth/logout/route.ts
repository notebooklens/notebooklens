import { NextRequest, NextResponse } from "next/server";

import { ApiRequestError, buildLoginHref, postLogout } from "@/lib/api";
import { buildFlashRedirect } from "@/lib/review-workspace";


export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const returnTo = requiredField(formData, "returnTo");

  try {
    await postLogout();
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 401) {
      return NextResponse.redirect(new URL(buildLoginHref(returnTo)), { status: 303 });
    }

    const detail =
      error instanceof ApiRequestError
        ? error.detail
        : "NotebookLens could not sign you out cleanly.";
    return NextResponse.redirect(
      new URL(buildFlashRedirect(returnTo, { tone: "error", message: detail }), request.nextUrl.origin),
      { status: 303 },
    );
  }

  return NextResponse.redirect(new URL(buildLoginHref(returnTo)), { status: 303 });
}


function requiredField(formData: FormData, key: string): string {
  const value = formData.get(key);
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing required form field: ${key}`);
  }
  return value.trim();
}
