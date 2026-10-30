import { NextResponse } from "next/server";
import { getDb, getDefaultUserId } from "@/lib/db";
import { listNotes } from "@/lib/db/repo/notes";
import { extractCards } from "@/lib/notes/cards";

export interface Insight {
  icon: string;
  title: string;
  detail: string;
  href: string;
  /** 建议权重（排序用，越高越靠前） */
  weight: number;
}

/**
 * 主动学习洞察（融合批次 F1 阶段 4，Muse proactive 启发）：
 * 从复习队列 / 画像 / 划词行为推导 ≤3 条数据驱动建议。
 * 纯"进入应用时的洞察卡"，无推送——不越 F4 触发条件。
 */
export async function GET() {
  const userId = getDefaultUserId();
  const db = getDb();
  const insights: Insight[] = [];

  // 1. 复习到期：从未复习或最久未复习的卡片笔记
  const queue = listNotes(userId, { withContent: true })
    .map((n) => {
      const cards = extractCards(n.content);
      const last = db.prepare("SELECT MAX(created_at) AS t FROM review_logs WHERE note_id = ?").get(n.id) as { t: string | null };
      return { id: n.id, title: n.title, cardCount: cards.length, lastReview: last.t };
    })
    .filter((x) => x.cardCount > 0);
  const dueNote =
    queue.find((q) => !q.lastReview) ??
    queue.sort((a, b) => (a.lastReview && b.lastReview ? a.lastReview.localeCompare(b.lastReview) : 0))[0];
  if (dueNote) {
    insights.push({
      icon: "🧠",
      title: `该复习《${dueNote.title.slice(0, 16)}${dueNote.title.length > 16 ? "…" : ""}》了`,
      detail: `${dueNote.cardCount} 张卡片${dueNote.lastReview ? "，距离上次复习已有一段时间" : "，从未复习过"}`,
      href: `/review?note=${dueNote.id}`,
      weight: 30,
    });
  }

  // 2. 衰减预警：概念距 90 天衰减线不足 10 天
  const dying = db
    .prepare(
      `SELECT c.name, c.domain, pe.mastery, pe.last_touched_at FROM profile_entries pe
       JOIN concepts c ON c.id = pe.concept_id
       WHERE pe.user_id = ? AND pe.last_touched_at < ? AND pe.last_touched_at > ?
       ORDER BY pe.last_touched_at ASC LIMIT 1`,
    )
    .get(userId, new Date(Date.now() - 80 * 86400_000).toISOString(), new Date(Date.now() - 90 * 86400_000).toISOString()) as
    | { name: string; domain: string; mastery: number; last_touched_at: string }
    | undefined;
  if (dying) {
    const days = Math.floor((Date.now() - new Date(dying.last_touched_at).getTime()) / 86400_000);
    insights.push({
      icon: "⏳",
      title: `「${dying.name}」快 ${90} 天没碰了`,
      detail: `掌握度 ${dying.mastery.toFixed(2)}，再不复习就要衰减了（已 ${days} 天）`,
      href: `/profile`,
      weight: 25,
    });
  }

  // 3. 薄弱概念：掌握度最低（<0.4）
  const weakest = db
    .prepare(
      `SELECT c.name, pe.mastery FROM profile_entries pe
       JOIN concepts c ON c.id = pe.concept_id
       WHERE pe.user_id = ? AND pe.mastery < 0.4
       ORDER BY pe.mastery ASC LIMIT 1`,
    )
    .get(userId) as { name: string; mastery: number } | undefined;
  if (weakest) {
    insights.push({
      icon: "🎯",
      title: `「${weakest.name}」是你目前最薄弱的概念`,
      detail: `掌握度仅 ${weakest.mastery.toFixed(2)}，来一轮针对性讲解把它拿下？`,
      href: `/?ask=${encodeURIComponent(`请针对我的薄弱点，系统讲讲「${weakest.name}」`)}`,
      weight: 20,
    });
  }

  // 4. 划词暗示：同一术语划选 ≥2 次但从未成为讲解主题
  const repeated = db
    .prepare(
      `SELECT selected_text, COUNT(*) AS n FROM selection_events
       WHERE user_id = ? AND action IN ('explain','rephrase')
       GROUP BY selected_text HAVING n >= 2
       ORDER BY n DESC LIMIT 1`,
    )
    .get(userId) as { selected_text: string; n: number } | undefined;
  if (repeated) {
    insights.push({
      icon: "🔍",
      title: `你已 ${repeated.n} 次划选「${repeated.selected_text.slice(0, 12)}」`,
      detail: "反复查一个词，说明它值得被系统学一遍——开个对话深入讲讲？",
      href: `/?ask=${encodeURIComponent(`请系统讲解「${repeated.selected_text}」`)}`,
      weight: 15,
    });
  }

  // 权重排序取前 3
  const top = insights.sort((a, b) => b.weight - a.weight).slice(0, 3);
  return NextResponse.json({ insights: top });
}
