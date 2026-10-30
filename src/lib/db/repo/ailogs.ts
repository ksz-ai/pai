import { getDb, nowIso, uuid } from "@/lib/db";
import type { DomainDist, StatsDTO } from "@/lib/types";

export function insertAiLog(opts: {
  userId: string;
  scene: "explain" | "extract" | "note" | "selection";
  model: string;
  promptVersion: string;
  tokenIn: number;
  tokenOut: number;
  latencyMs: number;
  status?: "ok" | "error";
}) {
  getDb()
    .prepare(
      "INSERT INTO ai_logs (id, user_id, scene, model, prompt_version, token_in, token_out, latency_ms, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      uuid(),
      opts.userId,
      opts.scene,
      opts.model,
      opts.promptVersion,
      opts.tokenIn,
      opts.tokenOut,
      opts.latencyMs,
      opts.status ?? "ok",
      nowIso(),
    );
}

export function stats(userId: string): StatsDTO {
  const db = getDb();
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const weekConversations = (
    db.prepare("SELECT COUNT(*) AS n FROM conversations WHERE user_id = ? AND created_at >= ?").get(userId, weekAgo) as { n: number }
  ).n;
  const totalConversations = (
    db.prepare("SELECT COUNT(*) AS n FROM conversations WHERE user_id = ?").get(userId) as { n: number }
  ).n;
  // 北极星（原型口径）：本周创建且已生成过笔记的会话 = 完成「提问→讲解→笔记」闭环
  const weekClosures = (
    db
      .prepare(
        "SELECT COUNT(DISTINCT n.conversation_id) AS n FROM notes n JOIN conversations c ON c.id = n.conversation_id WHERE c.user_id = ? AND c.created_at >= ?",
      )
      .get(userId, weekAgo) as { n: number }
  ).n;
  const profileEntries = (
    db.prepare("SELECT COUNT(*) AS n FROM profile_entries WHERE user_id = ?").get(userId) as { n: number }
  ).n;
  const domainDistribution = db
    .prepare(
      `SELECT c2.domain AS domain, COUNT(*) AS count FROM profile_entries pe
       JOIN concepts c2 ON c2.id = pe.concept_id
       WHERE pe.user_id = ? GROUP BY c2.domain ORDER BY count DESC LIMIT 6`,
    )
    .all(userId) as DomainDist[];
  const noteCount = (db.prepare("SELECT COUNT(*) AS n FROM notes WHERE user_id = ?").get(userId) as { n: number }).n;
  const tokens = db
    .prepare("SELECT COALESCE(SUM(token_in),0) AS tin, COALESCE(SUM(token_out),0) AS tout FROM ai_logs WHERE user_id = ? AND status = 'ok'")
    .get(userId) as { tin: number; tout: number };

  const priceIn = Number(process.env.PRICE_PER_1K_IN ?? "");
  const priceOut = Number(process.env.PRICE_PER_1K_OUT ?? "");
  const costEstimate =
    Number.isFinite(priceIn) && Number.isFinite(priceOut) && (priceIn > 0 || priceOut > 0)
      ? (tokens.tin / 1000) * priceIn + (tokens.tout / 1000) * priceOut
      : null;

  return {
    week_conversations: weekConversations,
    total_conversations: totalConversations,
    week_closures: weekClosures,
    profile_entries: profileEntries,
    domain_distribution: domainDistribution,
    note_count: noteCount,
    token_in: tokens.tin,
    token_out: tokens.tout,
    cost_estimate: costEstimate,
    avg_session_cost: costEstimate !== null && totalConversations > 0 ? costEstimate / totalConversations : null,
  };
}

export function wipeAllData(userId: string) {
  const db = getDb();
  const run = db.transaction(() => {
    db.prepare("DELETE FROM profile_logs").run();
    db.prepare("DELETE FROM profile_entries WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM notes WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM messages WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM conversations WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM ai_logs WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM concepts WHERE id NOT IN (SELECT DISTINCT concept_id FROM profile_entries)").run();
  });
  run();
}
