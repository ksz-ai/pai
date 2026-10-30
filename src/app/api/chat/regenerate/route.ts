import { NextRequest } from "next/server";
import { getDefaultUserId } from "@/lib/db";
import { getConversation } from "@/lib/db/repo/conversations";
import { activeChain, getMessage, nextSlot } from "@/lib/db/repo/messages";
import { explain } from "@/lib/pipeline/explain";
import { sseResponse } from "@/lib/sse";
import type { FeedbackKind, MessageMeta } from "@/lib/types";

interface Body {
  message_id?: string; // 重新生成这条 assistant 消息（新版本）
  reply_to_message_id?: string; // 编辑后为这条 user 消息生成新回复
  reason?: "manual" | "feedback" | "retry" | "edit";
  feedback?: FeedbackKind;
}

/**
 * 统一重生成入口：手动重生成 / 深度反馈 / 中断重试 / 编辑后重答（均为 SSE）。
 */
export async function POST(req: NextRequest) {
  const userId = getDefaultUserId();
  const body = (await req.json()) as Body;
  const reason = body.reason ?? "manual";

  let targetSlot: number;
  let history: { role: "user" | "assistant"; content: string }[];
  let conversationId: string;
  let prevMeta: MessageMeta | null = null;
  let regenAssistantId: string | undefined;

  if (body.message_id) {
    // 重生成既有 assistant 消息：同 slot 新 revision，旧版保留可回看
    const msg = getMessage(body.message_id);
    if (!msg || msg.user_id !== userId) return Response.json({ error: "消息不存在" }, { status: 404 });
    if (msg.role !== "assistant") return Response.json({ error: "只能重新生成 AI 回答" }, { status: 400 });
    const conv = getConversation(msg.conversation_id, userId);
    if (!conv) return Response.json({ error: "会话不存在" }, { status: 404 });
    conversationId = conv.id;
    targetSlot = msg.slot_index;
    prevMeta = msg.meta ? (JSON.parse(msg.meta) as MessageMeta) : null;
    regenAssistantId = msg.id;
    history = activeChain(conversationId)
      .filter((m) => m.slot_index < targetSlot)
      .map((m) => ({ role: m.role, content: m.content }));
  } else if (body.reply_to_message_id) {
    // 编辑后的 user 消息：在其 slot+1 生成新回复（仅当该位置没有 assistant 占用）
    const msg = getMessage(body.reply_to_message_id);
    if (!msg || msg.user_id !== userId) return Response.json({ error: "消息不存在" }, { status: 404 });
    if (msg.role !== "user") return Response.json({ error: "只能对用户消息生成回复" }, { status: 400 });
    const conv = getConversation(msg.conversation_id, userId);
    if (!conv) return Response.json({ error: "会话不存在" }, { status: 404 });
    conversationId = conv.id;
    const occupied = activeChain(conversationId).some((m) => m.slot_index === msg.slot_index + 1 && m.role === "assistant");
    if (occupied) {
      return Response.json({ error: "该消息已有回复，请用 message_id 模式重新生成" }, { status: 409 });
    }
    targetSlot = msg.slot_index + 1;
    if (targetSlot >= nextSlot(conversationId)) targetSlot = nextSlot(conversationId);
    history = activeChain(conversationId)
      .filter((m) => m.slot_index < targetSlot)
      .map((m) => ({ role: m.role, content: m.content }));
  } else {
    return Response.json({ error: "message_id 或 reply_to_message_id 必填" }, { status: 400 });
  }

  const gen = explain({
    userId,
    conversationId,
    history,
    abortSignal: req.signal,
    ...(regenAssistantId
      ? {
          regen: {
            assistantMessageId: regenAssistantId,
            slotIndex: targetSlot,
            reason,
            feedback: body.feedback,
            prevMeta,
          },
        }
      : {}),
  });
  return sseResponse(gen);
}
