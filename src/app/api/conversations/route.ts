import { NextRequest, NextResponse } from "next/server";
import { getDefaultUserId } from "@/lib/db";
import { createConversation, listConversations } from "@/lib/db/repo/conversations";

export async function GET() {
  const userId = getDefaultUserId();
  return NextResponse.json(listConversations(userId));
}

export async function POST(req: NextRequest) {
  const userId = getDefaultUserId();
  const body = (await req.json().catch(() => ({}))) as { title?: string };
  const conv = createConversation(userId, body.title?.trim() || "新会话");
  return NextResponse.json(conv, { status: 201 });
}
