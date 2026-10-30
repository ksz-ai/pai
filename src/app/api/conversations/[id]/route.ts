import { NextRequest, NextResponse } from "next/server";
import { getDefaultUserId } from "@/lib/db";
import { deleteConversation, getConversation, renameConversation } from "@/lib/db/repo/conversations";
import { activeChain } from "@/lib/db/repo/messages";
import type { MessageDTO } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const userId = getDefaultUserId();
  const conv = getConversation(id, userId);
  if (!conv) return NextResponse.json({ error: "会话不存在" }, { status: 404 });
  const messages: MessageDTO[] = activeChain(id);
  return NextResponse.json({ conversation: conv, messages });
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const userId = getDefaultUserId();
  const body = (await req.json()) as { title?: string };
  if (!body.title?.trim()) return NextResponse.json({ error: "标题不能为空" }, { status: 400 });
  renameConversation(id, userId, body.title.trim());
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const userId = getDefaultUserId();
  deleteConversation(id, userId);
  return NextResponse.json({ ok: true });
}
