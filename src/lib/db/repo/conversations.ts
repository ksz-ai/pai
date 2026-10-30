import { getDb, nowIso, uuid } from "@/lib/db";
import type { ConversationDTO } from "@/lib/types";

export function listConversations(userId: string): ConversationDTO[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT c.*,
        (SELECT COUNT(DISTINCT slot_index) FROM messages m WHERE m.conversation_id = c.id) AS message_count,
        (SELECT content FROM messages m
          JOIN (SELECT slot_index, MAX(revision) AS max_rev FROM messages WHERE conversation_id = c.id GROUP BY slot_index) t
            ON m.slot_index = t.slot_index AND m.revision = t.max_rev
          WHERE m.conversation_id = c.id
          ORDER BY m.slot_index DESC LIMIT 1) AS preview
       FROM conversations c WHERE c.user_id = ? ORDER BY c.updated_at DESC`,
    )
    .all(userId) as Array<{
    id: string;
    title: string;
    created_at: string;
    updated_at: string;
    message_count: number;
    preview: string | null;
  }>;
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    created_at: r.created_at,
    updated_at: r.updated_at,
    message_count: r.message_count ?? 0,
    preview: (r.preview ?? "").slice(0, 120),
  }));
}

export function getConversation(id: string, userId: string) {
  return getDb()
    .prepare("SELECT * FROM conversations WHERE id = ? AND user_id = ?")
    .get(id, userId) as { id: string; user_id: string; title: string; created_at: string; updated_at: string; token_used: number } | undefined;
}

export function createConversation(userId: string, title = "新会话") {
  const id = uuid();
  const ts = nowIso();
  getDb()
    .prepare("INSERT INTO conversations (id, user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .run(id, userId, title, ts, ts);
  return { id, title, created_at: ts, updated_at: ts };
}

export function renameConversation(id: string, userId: string, title: string) {
  getDb()
    .prepare("UPDATE conversations SET title = ?, updated_at = ? WHERE id = ? AND user_id = ?")
    .run(title.slice(0, 80), nowIso(), id, userId);
}

export function touchConversation(id: string, tokens = 0) {
  getDb()
    .prepare("UPDATE conversations SET updated_at = ?, token_used = token_used + ? WHERE id = ?")
    .run(nowIso(), tokens, id);
}

/**
 * 删除会话（级联，PRD FR-01 ② / AC-01-2 / E-12）：
 * - 笔记保留正文，标记「来源已删除」
 * - 画像条目移除指向该会话消息的证据；证据清零的条目删除（FR-04 ④ 无证据不得存在）
 * - 消息与会话删除，不留孤儿数据
 */
export function deleteConversation(id: string, userId: string) {
  const db = getDb();
  const run = db.transaction(() => {
    const msgIds = (db.prepare("SELECT id FROM messages WHERE conversation_id = ?").all(id) as { id: string }[]).map((r) => r.id);
    if (msgIds.length > 0) {
      const entries = db.prepare("SELECT id, evidence_refs FROM profile_entries WHERE user_id = ?").all(userId) as {
        id: string;
        evidence_refs: string;
      }[];
      const ts = nowIso();
      for (const e of entries) {
        const refs = JSON.parse(e.evidence_refs || "[]") as { type: string; id: string }[];
        const kept = refs.filter((r) => !msgIds.includes(r.id));
        if (kept.length === refs.length) continue;
        if (kept.length === 0) {
          db.prepare(
            "INSERT INTO profile_logs (id, profile_entry_id, old_value, new_value, signal_type, detail, created_at) VALUES (?,?,?,?,?,?,?)",
          ).run(uuid(), e.id, null, null, "evidence_lost_delete", "来源会话删除，证据清零，条目移除", ts);
          db.prepare("DELETE FROM profile_entries WHERE id = ?").run(e.id);
        } else {
          db.prepare("UPDATE profile_entries SET evidence_refs = ?, updated_at = ? WHERE id = ?").run(
            JSON.stringify(kept),
            ts,
            e.id,
          );
        }
      }
    }
    db.prepare(
      `UPDATE notes SET status = 'source_deleted', conversation_id = NULL, source_conversation_id = COALESCE(source_conversation_id, ?), updated_at = ?
       WHERE conversation_id = ? AND user_id = ?`,
    ).run(id, nowIso(), id, userId);
    db.prepare("DELETE FROM messages WHERE conversation_id = ?").run(id);
    db.prepare("DELETE FROM conversations WHERE id = ? AND user_id = ?").run(id, userId);
  });
  run();
}
