import { NextRequest } from "next/server";
import { getDefaultUserId } from "@/lib/db";
import { getNote, writeNoteWithAnchors } from "@/lib/db/repo/notes";
import { getConversation } from "@/lib/db/repo/conversations";
import { activeChain } from "@/lib/db/repo/messages";
import { chatComplete, llmEnv } from "@/lib/llm/client";
import { buildAppendMergeMessages, APPEND_MERGE_PROMPT_VERSION } from "@/lib/llm/prompts/append-merge";
import { rewriteAppendAnchors } from "@/lib/notes/anchors";
import { insertAiLog } from "@/lib/db/repo/ailogs";
import { budgetState } from "@/lib/pipeline/explain";
import * as profileRepo from "@/lib/db/repo/profile";
import { getDb, nowIso } from "@/lib/db";

/** 追加整理（B-1）：把一段新对话合并进已有笔记。原笔记版本 +1，旧版留档。 */
export async function POST(req: NextRequest) {
  const userId = getDefaultUserId();
  const env = llmEnv();
  if (!env) return Response.json({ error: "未配置模型服务" }, { status: 503 });

  const body = (await req.json()) as { note_id?: string; conversation_id?: string; from_slot?: number };
  if (!body.note_id || !body.conversation_id) {
    return Response.json({ error: "note_id 与 conversation_id 必填" }, { status: 400 });
  }
  const note = getNote(body.note_id, userId);
  if (!note) return Response.json({ error: "笔记不存在" }, { status: 404 });
  const conv = getConversation(body.conversation_id, userId);
  if (!conv) return Response.json({ error: "会话不存在" }, { status: 404 });

  const budget = budgetState(conv.id, userId);
  if (budget.blocked) {
    return Response.json({ error: `本次会话累计已用 ${budget.used.toLocaleString()} tokens，超出预算，无法追加整理。` }, { status: 403 });
  }

  let msgs = activeChain(conv.id).filter((m) => m.status !== "stale" || m.role === "user");
  if (body.from_slot !== undefined) msgs = msgs.filter((m) => m.slot_index >= body.from_slot!);
  if (msgs.length < 1) return Response.json({ error: "对话内容太少，无法追加" }, { status: 400 });
  // 同一会话不能重复追加进同一篇笔记（锚点会重复登记）
  if (note.anchors.some((a) => a.conversation_id === conv.id)) {
    return Response.json({ error: "这篇笔记已经整合过该会话的内容，请换一篇笔记或新建笔记" }, { status: 409 });
  }

  const sourceText = msgs.map((m) => `[m${m.slot_index}] ${m.role === "user" ? "问" : "答"}：${m.content.slice(0, 3000)}`).join("\n\n");
  const validSlots = new Set(msgs.map((m) => m.slot_index));

  const started = Date.now();
  let content: string;
  try {
    const r = await chatComplete(env, buildAppendMergeMessages(note.content, sourceText), { timeoutMs: 120_000 });
    content = r.content.trim().replace(/^```\w*\n?|```\s*$/g, "").trim();
    insertAiLog({
      userId,
      scene: "note",
      model: env.model,
      promptVersion: APPEND_MERGE_PROMPT_VERSION,
      tokenIn: r.tokenIn,
      tokenOut: r.tokenOut,
      latencyMs: Date.now() - started,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    insertAiLog({ userId, scene: "note", model: env.model, promptVersion: APPEND_MERGE_PROMPT_VERSION, tokenIn: 0, tokenOut: 0, latencyMs: Date.now() - started, status: "error" });
    return Response.json({ error: `追加整理失败：${message}` }, { status: 502 });
  }

  if (/^SKIP$/i.test(content)) {
    return Response.json({ unchanged: true, message: "新对话没有值得记录的实质内容，笔记保持不变" });
  }

  // 锚点改写：新 [[mN]] → 续编 [[aK]]；既有 [[aK]] 原样保留
  const rewritten = rewriteAppendAnchors(content, note.anchors, conv.id, validSlots);

  // 画像信号：新对话提及的概念刷新接触时间（FR-08 ④）
  const db = getDb();
  const ts = nowIso();
  for (const e of profileRepo.listEntries(userId)) {
    if (rewritten.content.includes(e.concept_name)) {
      db.prepare("UPDATE profile_entries SET last_touched_at = ?, updated_at = ? WHERE id = ?").run(ts, ts, e.id);
      profileRepo.insertLog(e.id, e.mastery, e.mastery, "note_touch", `追加整理《${note.title}》提及`);
    }
  }

  writeNoteWithAnchors(note.id, userId, rewritten.content, rewritten.anchors);
  return Response.json({ added: rewritten.added, note: getNote(note.id, userId) });
}
