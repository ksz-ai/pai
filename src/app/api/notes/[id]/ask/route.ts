import { NextRequest } from "next/server";
import { getDefaultUserId } from "@/lib/db";
import { getNote } from "@/lib/db/repo/notes";
import { chatStream, fastModel, llmEnv } from "@/lib/llm/client";
import { buildNoteAskMessages, NOTE_ASK_PROMPT_VERSION } from "@/lib/llm/prompts/note-ask";
import { insertAiLog } from "@/lib/db/repo/ailogs";
import { sseResponse } from "@/lib/sse";
import { settleDecay } from "@/lib/profile/engine";
import { listEntries } from "@/lib/db/repo/profile";
import type { SSEEvent } from "@/lib/types";

/** 与笔记对话（SPEC M2-3）：基于本篇笔记的流式问答，临时会话不落库。 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const userId = getDefaultUserId();
  const env = llmEnv();
  if (!env) {
    return Response.json({ error: "未配置模型服务" }, { status: 503 });
  }
  const { id } = await ctx.params;
  const note = getNote(id, userId);
  if (!note) return Response.json({ error: "笔记不存在" }, { status: 404 });

  const body = (await req.json()) as { question?: string; history?: { role: "user" | "assistant"; content: string }[] };
  const question = body.question?.trim();
  if (!question) return Response.json({ error: "question 必填" }, { status: 400 });
  const history = (body.history ?? []).filter((h) => h.role && h.content).slice(-10);

  settleDecay(userId);
  // 画像提示：问题命中的概念带掌握度
  const entries = listEntries(userId);
  const hints = entries
    .filter((e) => question.includes(e.concept_name) || note.content.includes(e.concept_name))
    .slice(0, 5)
    .map((e) => `${e.concept_name} ${e.mastery.toFixed(2)}`);
  const masteryHint = hints.length ? hints.join("、") : "无相关记录，按通用基础水平讲解";

  const noteContent = note.content.slice(0, 8000);
  const started = Date.now();
  let full = "";
  let tokenIn = 0;
  let tokenOut = 0;

  const gen = async function* (): AsyncGenerator<SSEEvent> {
    try {
      for await (const chunk of chatStream(env, buildNoteAskMessages(noteContent, note.title, masteryHint, history, question), {
        model: fastModel(),
        firstTokenTimeoutMs: 15_000,
        signal: req.signal,
      })) {
        if (chunk.type === "delta") {
          full += chunk.text;
          yield { type: "delta", text: chunk.text };
        } else {
          tokenIn = chunk.tokenIn;
          tokenOut = chunk.tokenOut;
        }
      }
      insertAiLog({ userId, scene: "explain", model: fastModel(), promptVersion: NOTE_ASK_PROMPT_VERSION, tokenIn, tokenOut, latencyMs: Date.now() - started });
      yield {
        type: "done",
        assistant_message_id: "",
        token_in: tokenIn,
        token_out: tokenOut,
        latency_ms: Date.now() - started,
        model: fastModel(),
        profile_updates: [],
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      insertAiLog({ userId, scene: "explain", model: fastModel(), promptVersion: NOTE_ASK_PROMPT_VERSION, tokenIn, tokenOut, latencyMs: Date.now() - started, status: "error" });
      yield { type: "error", code: "model_error", message: `笔记问答失败：${message}` };
    }
  };

  return sseResponse(gen());
}
