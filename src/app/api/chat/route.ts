import { NextRequest } from "next/server";
import { getDefaultUserId } from "@/lib/db";
import { getConversation, touchConversation } from "@/lib/db/repo/conversations";
import { activeChain, insertMessage, nextSlot } from "@/lib/db/repo/messages";
import { explain } from "@/lib/pipeline/explain";
import { sseResponse } from "@/lib/sse";
import { llmEnv } from "@/lib/llm/client";

/** 发送消息 → 流式自适应讲解（SSE） */
export async function POST(req: NextRequest) {
  const userId = getDefaultUserId();
  if (!llmEnv()) {
    return Response.json({ error: "未配置模型服务：请前往设置页，选择服务商并粘贴 API Key（1 分钟搞定）" }, { status: 503 });
  }
  const body = (await req.json()) as { conversation_id?: string; content?: string };
  const content = body.content?.trim();
  if (!body.conversation_id || !content) {
    return Response.json({ error: "conversation_id 与 content 必填" }, { status: 400 });
  }
  const conv = getConversation(body.conversation_id, userId);
  if (!conv) return Response.json({ error: "会话不存在" }, { status: 404 });

  // 历史取插入前的活动链
  const history = activeChain(conv.id).map((m) => ({ role: m.role, content: m.content }));

  const slot = nextSlot(conv.id);
  const userMessageId = insertMessage({
    conversationId: conv.id,
    userId,
    role: "user",
    content,
    slotIndex: slot,
    revision: 1,
  });

  // 首条消息：以问题截断作为会话标题（不额外消耗一次 LLM 调用）
  if (history.length === 0 && conv.title === "新会话") {
    const title = content.replace(/\s+/g, " ").slice(0, 30);
    const db = (await import("@/lib/db")).getDb();
    db.prepare("UPDATE conversations SET title = ? WHERE id = ?").run(title, conv.id);
  } else {
    touchConversation(conv.id);
  }

  const gen = explain({
    userId,
    conversationId: conv.id,
    userMessageId,
    userText: content,
    userSlot: slot,
    history,
    abortSignal: req.signal,
  });
  return sseResponse(gen);
}
