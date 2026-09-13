import { NextRequest } from "next/server";
import { handleThreadAction } from "@/lib/thread-action";

export async function POST(request: NextRequest) {
  return handleThreadAction(request, "create");
}
