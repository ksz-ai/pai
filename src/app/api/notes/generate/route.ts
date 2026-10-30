import { NextRequest } from "next/server";
import { getDefaultUserId } from "@/lib/db";
import { getConversation } from "@/lib/db/repo/conversations";
import { activeChain } from "@/lib/db/repo/messages";
import { createNote } from "@/lib/db/repo/notes";
import { insertAiLog } from "@/lib/db/repo/ailogs";
import { chatComplete, llmEnv } from "@/lib/llm/client";
import { buildNoteMessages, NOTE_PROMPT_VERSION } from "@/lib/llm/prompts/note";
import * as profileRepo from "@/lib/db/repo/profile";
import * as conversationsRepo from "@/lib/db/repo/conversations";
import { budgetState } from "@/lib/pipeline/explain";
import { rewriteGenerationAnchors } from "@/lib/notes/anchors";
import { stripDiagramBlocks } from "@/lib/diagram/markdown";
import { getDb, nowIso } from "@/lib/db";

/** 从对话生成结构化讲义（FR-05）。失败重试一次（E-04），锚点校验。 */
export async function POST(req: NextRequest) {
  const userId = getDefaultUserId();
  const env = llmEnv();
  if (!env) return Response.json({ error: "未配置模型服务" }, { status: 503 });

  const body = (await req.json()) as { conversation_id?: string; from_slot?: number; to_slot?: number };
  if (!body.conversation_id) return Response.json({ error: "conversation_id 必填" }, { status: 400 });
  const conv = getConversation(body.conversation_id, userId);
  if (!conv) return Response.json({ error: "会话不存在" }, { status: 404 });

  // FR-09 ③：会话超预算时阻断新调用（E-05）
  const budget = budgetState(conv.id, userId);
  if (budget.blocked) {
    return Response.json(
      { error: `本次会话累计已用 ${budget.used.toLocaleString()} tokens，超出预算，无法再生成笔记。建议开启新会话；当前会话仍可阅读。` },
      { status: 403 },
    );
  }

  let msgs = activeChain(conv.id);
  if (body.from_slot !== undefined) msgs = msgs.filter((m) => m.slot_index >= body.from_slot!);
  if (body.to_slot !== undefined) msgs = msgs.filter((m) => m.slot_index <= body.to_slot!);
  msgs = msgs.filter((m) => m.status !== "stale" || m.role === "user");
  if (msgs.length < 2) return Response.json({ error: "对话内容太少，无法生成笔记" }, { status: 400 });

  // 图示 spec（```diagram JSON）是渲染层产物，不进笔记源文本（防 JSON 噪声误导整理）
  const sourceText = msgs
    .map((m) => `[m${m.slot_index}] ${m.role === "user" ? "问" : "答"}：${stripDiagramBlocks(m.content).slice(0, 4000)}`)
    .join("\n\n");

  let content = "";
  let warning: string | null = null;
  let tokenIn = 0;
  let tokenOut = 0;
  let latencyMs = 0;

  const generate = async (strict: boolean) => {
    const base = buildNoteMessages(sourceText);
    if (strict) {
      base[0] = {
        ...base[0],
        content: base[0].content + "\n\n注意：上一版结构不合规。这次必须包含全部五个二级标题，且每条核心概念都带 [[mN]] 锚点。",
      };
    }
    const r = await chatComplete(env, base, { timeoutMs: 120_000 });
    tokenIn += r.tokenIn;
    tokenOut += r.tokenOut;
    latencyMs += r.latencyMs;
    return r.content.trim();
  };

  try {
    content = await generate(false);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    insertAiLog({ userId, scene: "note", model: env.model, promptVersion: NOTE_PROMPT_VERSION, tokenIn, tokenOut, latencyMs, status: "error" });
    return Response.json({ error: `笔记生成失败：${message}` }, { status: 502 });
  }

  // 结构校验：核心概念段存在且带锚点（E-04：不合规补生成一次）
  const slotsOf = (text: string) =>
    [...text.matchAll(/\[\[m(\d+)\]\]/g)].map((m) => Number(m[1]));
  const validSlots = new Set(msgs.map((m) => m.slot_index));
  const structOk = (text: string) =>
    text.includes("## 核心概念") && slotsOf(text).some((s) => validSlots.has(s));

  if (!structOk(content)) {
    try {
      content = await generate(true);
    } catch {
      /* 保底使用第一版 */
    }
    if (!structOk(content)) warning = "部分章节结构不完整或锚点缺失，可编辑修正后使用";
  }

  content = content.replace(/^```\w*\n?|```\s*$/g, "").trim();
  const titleMatch = content.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : conv.title;
  // 锚点 v2：[[mN]] → [[aK]] 改写（无效槽位剔除）
  const rewritten = rewriteGenerationAnchors(content, conv.id, validSlots);
  content = rewritten.content;

  const note = createNote({
    userId,
    conversationId: conv.id,
    sourceTitle: conv.title,
    title,
    content,
    anchors: rewritten.anchors,
  });
  insertAiLog({ userId, scene: "note", model: env.model, promptVersion: NOTE_PROMPT_VERSION, tokenIn, tokenOut, latencyMs });
  conversationsRepo.touchConversation(conv.id, tokenIn + tokenOut);

  // 画像信号（FR-08 ④）：笔记提及的概念刷新接触时间
  const db = getDb();
  const ts = nowIso();
  for (const e of profileRepo.listEntries(userId)) {
    if (content.includes(e.concept_name)) {
      db.prepare("UPDATE profile_entries SET last_touched_at = ?, updated_at = ? WHERE id = ?").run(ts, ts, e.id);
      profileRepo.insertLog(e.id, e.mastery, e.mastery, "note_touch", `笔记《${title}》提及`);
    }
  }

  return Response.json({ note, warning });
}

