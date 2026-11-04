import { NextResponse } from "next/server";
import { getDb, getDefaultUserId } from "@/lib/db";
import { createNote } from "@/lib/db/repo/notes";
import { chatComplete, llmEnv } from "@/lib/llm/client";
import { buildWeeklyReportMessages, WEEKLY_REPORT_PROMPT_VERSION, type WeeklyData } from "@/lib/llm/prompts/weekly-report";
import { insertAiLog } from "@/lib/db/repo/ailogs";

/** 学习周报（SPEC M2-4）：聚合本周数据 → LLM 叙事周报 → 保存为新笔记（domain=学习周报） */
export async function POST() {
  const userId = getDefaultUserId();
  const env = llmEnv();
  if (!env) return NextResponse.json({ error: "未配置模型服务" }, { status: 503 });
  const db = getDb();

  const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
  const range = `${new Date(weekAgo).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })} – ${new Date().toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })}`;

  const conversations = (db.prepare("SELECT COUNT(*) AS n FROM conversations WHERE user_id = ? AND created_at >= ?").get(userId, weekAgo) as { n: number }).n;

  // 本周概念接触（讲解消息 meta 提及的去重概念）
  const conceptsTouched: string[] = [];
  const msgRows = db
    .prepare("SELECT meta FROM messages WHERE user_id = ? AND role = 'assistant' AND created_at >= ? AND meta IS NOT NULL")
    .all(userId, weekAgo) as Array<{ meta: string }>;
  const touched = new Set<string>();
  for (const r of msgRows) {
    try {
      const m = JSON.parse(r.meta) as { concept_name?: string };
      if (m.concept_name) touched.add(m.concept_name);
    } catch {
      /* 忽略坏数据 */
    }
  }
  conceptsTouched.push(...touched);

  // 掌握度净变化：本周 profile_logs 按条目聚合（首末差值）
  const logRows = db
    .prepare(
      `SELECT pl.profile_entry_id, c.name, pl.old_value, pl.new_value FROM profile_logs pl
       JOIN profile_entries pe ON pe.id = pl.profile_entry_id
       JOIN concepts c ON c.id = pe.concept_id
       WHERE pe.user_id = ? AND pl.created_at >= ? AND pl.old_value IS NOT NULL AND pl.new_value IS NOT NULL
       ORDER BY pl.created_at ASC`,
    )
    .all(userId, weekAgo) as Array<{ profile_entry_id: string; name: string; old_value: number; new_value: number }>;
  const delta = new Map<string, { name: string; from: number; to: number }>();
  for (const r of logRows) {
    const cur = delta.get(r.profile_entry_id);
    if (!cur) delta.set(r.profile_entry_id, { name: r.name, from: r.old_value, to: r.new_value });
    else cur.to = r.new_value;
  }
  const masteryChanges = [...delta.values()].filter((d) => Math.abs(d.to - d.from) > 0.001);

  const weakest = (
    db
      .prepare(
        `SELECT c.name, pe.mastery FROM profile_entries pe JOIN concepts c ON c.id = pe.concept_id
         WHERE pe.user_id = ? ORDER BY pe.mastery ASC LIMIT 3`,
      )
      .all(userId) as Array<{ name: string; mastery: number }>
  ).map((x) => ({ name: x.name, mastery: x.mastery }));

  const noteRows = db
    .prepare("SELECT id, title FROM notes WHERE user_id = ? AND created_at >= ?")
    .all(userId, weekAgo) as Array<{ id: string; title: string }>;
  const notesCreated = noteRows.length;

  const reviewCount = (db.prepare("SELECT COUNT(*) AS n FROM review_logs WHERE created_at >= ?").get(weekAgo) as { n: number }).n;
  const selectionCount = (db.prepare("SELECT COUNT(*) AS n FROM selection_events WHERE created_at >= ?").get(weekAgo) as { n: number }).n;

  const data: WeeklyData = {
    range,
    conversations,
    conceptsTouched,
    masteryChanges,
    weakest,
    notesCreated,
    noteTitles: noteRows.map((n) => n.title),
    reviewCount,
    selectionCount,
  };

  const started = Date.now();
  try {
    const r = await chatComplete(env, buildWeeklyReportMessages(data), { timeoutMs: 120_000 });
    const content = r.content.trim().replace(/^```\w*\n?|```\s*$/g, "").trim();
    insertAiLog({ userId, scene: "note", model: env.model, promptVersion: WEEKLY_REPORT_PROMPT_VERSION, tokenIn: r.tokenIn, tokenOut: r.tokenOut, latencyMs: Date.now() - started });

    const titleMatch = content.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim().slice(0, 60) : `学习周报 ${range}`;
    const note = createNote({
      userId,
      conversationId: null,
      sourceTitle: "学习周报",
      title,
      content,
      anchors: [],
      domain: "学习周报",
    });
    return NextResponse.json({ note });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    insertAiLog({ userId, scene: "note", model: env.model, promptVersion: WEEKLY_REPORT_PROMPT_VERSION, tokenIn: 0, tokenOut: 0, latencyMs: Date.now() - started, status: "error" });
    return NextResponse.json({ error: `周报生成失败：${message}` }, { status: 502 });
  }
}
