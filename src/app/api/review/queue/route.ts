import { NextResponse } from "next/server";
import { getDb, getDefaultUserId } from "@/lib/db";
import { listNotes } from "@/lib/db/repo/notes";
import { extractCards } from "@/lib/notes/cards";

/**
 * 复习队列（C 轻量版）：有卡片的笔记按
 * 从未复习优先 → 最久未复习 → 掌握度低优先 排序。
 */
export async function GET() {
  const userId = getDefaultUserId();
  const db = getDb();
  const items = listNotes(userId, { withContent: true })
    .map((n) => {
      const cards = extractCards(n.content);
      const last = db
        .prepare("SELECT MAX(created_at) AS t FROM review_logs WHERE note_id = ?")
        .get(n.id) as { t: string | null };
      const fronts = cards.map((c) => c.front);
      const masteryVals = fronts
        .map((f) => {
          const e = db
            .prepare(
              `SELECT pe.mastery FROM profile_entries pe JOIN concepts c ON c.id = pe.concept_id
               WHERE pe.user_id = ? AND c.name = ?`,
            )
            .get(userId, f) as { mastery: number } | undefined;
          return e?.mastery;
        })
        .filter((m): m is number => typeof m === "number");
      return {
        note: n,
        cardCount: cards.length,
        lastReview: last.t,
        minMastery: masteryVals.length ? Math.min(...masteryVals) : null,
      };
    })
    .filter((x) => x.cardCount > 0)
    .sort((a, b) => {
      if (!a.lastReview && b.lastReview) return -1;
      if (a.lastReview && !b.lastReview) return 1;
      if (a.lastReview && b.lastReview && a.lastReview !== b.lastReview) return a.lastReview < b.lastReview ? -1 : 1;
      const am = a.minMastery ?? 0.5;
      const bm = b.minMastery ?? 0.5;
      return am - bm;
    });
  return NextResponse.json({ queue: items });
}
