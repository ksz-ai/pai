import { NextRequest, NextResponse } from "next/server";
import { getDefaultUserId } from "@/lib/db";
import { activeChain, getMessage, insertMessage, markStaleAfter, nextRevision } from "@/lib/db/repo/messages";

type Ctx = { params: Promise<{ id: string }> };

/**
 * 编辑用户消息（FR-02 ①③）：产生同 slot 新版本（旧版保留可回看），
 * 其后的 AI 回答标记为 stale（基于旧提问内容，折叠展示、可单独重生成）。
 */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const userId = getDefaultUserId();
  const body = (await req.json()) as { content?: string };
  const content = body.content?.trim();
  if (!content) return NextResponse.json({ error: "内容不能为空" }, { status: 400 });

  const msg = getMessage(id);
  if (!msg || msg.user_id !== userId) return NextResponse.json({ error: "消息不存在" }, { status: 404 });
  if (msg.role !== "user") return NextResponse.json({ error: "只能编辑自己的消息" }, { status: 400 });
  if (msg.content === content) return NextResponse.json({ error: "内容未变化" }, { status: 400 });

  const revision = nextRevision(msg.conversation_id, msg.slot_index);
  const newId = insertMessage({
    conversationId: msg.conversation_id,
    userId,
    role: "user",
    content,
    slotIndex: msg.slot_index,
    revision,
    parentMessageId: msg.id,
    editedFrom: msg.content,
  });
  markStaleAfter(msg.conversation_id, msg.slot_index);

  const chain = activeChain(msg.conversation_id);
  const nextAssistant = chain.find((m) => m.slot_index === msg.slot_index + 1 && m.role === "assistant");
  return NextResponse.json({
    ok: true,
    new_message_id: newId,
    conversation_id: msg.conversation_id,
    slot_index: msg.slot_index,
    next_assistant: nextAssistant ? { id: nextAssistant.id, slot: nextAssistant.slot_index } : null,
  });
}
