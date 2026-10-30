import { getDb, nowIso, uuid } from "@/lib/db";
import type { MessageDTO, MessageMeta, MessageStatus, Role } from "@/lib/types";

interface MsgRow {
  id: string;
  conversation_id: string;
  user_id: string;
  role: Role;
  content: string;
  slot_index: number;
  revision: number;
  parent_message_id: string | null;
  status: MessageStatus;
  meta: string | null;
  edited_from: string | null;
  created_at: string;
}

function toDTO(r: MsgRow): MessageDTO {
  return {
    id: r.id,
    conversation_id: r.conversation_id,
    role: r.role,
    content: r.content,
    slot_index: r.slot_index,
    revision: r.revision,
    status: r.status,
    meta: r.meta ? (JSON.parse(r.meta) as MessageMeta) : null,
    has_history: r.revision > 1,
    edited_from: r.edited_from,
    created_at: r.created_at,
  };
}

/** 每个 slot 取最新 revision，构成当前对话视图 */
export function activeChain(conversationId: string): MessageDTO[] {
  const rows = getDb()
    .prepare(
      `SELECT m.* FROM messages m
       JOIN (SELECT slot_index, MAX(revision) AS max_rev FROM messages WHERE conversation_id = ? GROUP BY slot_index) t
         ON m.slot_index = t.slot_index AND m.revision = t.max_rev
       WHERE m.conversation_id = ?
       ORDER BY m.slot_index`,
    )
    .all(conversationId, conversationId) as unknown as MsgRow[];
  return rows.map(toDTO);
}

/** 某 slot 的全部版本（查看历史版本） */
export function revisionsOfSlot(conversationId: string, slotIndex: number): MessageDTO[] {
  const rows = getDb()
    .prepare("SELECT * FROM messages WHERE conversation_id = ? AND slot_index = ? ORDER BY revision DESC")
    .all(conversationId, slotIndex) as unknown as MsgRow[];
  return rows.map(toDTO);
}

export function getMessage(id: string): MsgRow | undefined {
  return getDb().prepare("SELECT * FROM messages WHERE id = ?").get(id) as MsgRow | undefined;
}

export function nextSlot(conversationId: string): number {
  const row = getDb()
    .prepare("SELECT COALESCE(MAX(slot_index), -1) + 1 AS next FROM messages WHERE conversation_id = ?")
    .get(conversationId) as { next: number };
  return row.next;
}

export function nextRevision(conversationId: string, slotIndex: number): number {
  const row = getDb()
    .prepare("SELECT COALESCE(MAX(revision), 0) + 1 AS next FROM messages WHERE conversation_id = ? AND slot_index = ?")
    .get(conversationId, slotIndex) as { next: number };
  return row.next;
}

export function insertMessage(opts: {
  conversationId: string;
  userId: string;
  role: Role;
  content: string;
  slotIndex: number;
  revision: number;
  parentMessageId?: string | null;
  status?: MessageStatus;
  meta?: MessageMeta | null;
  editedFrom?: string | null;
}): string {
  const id = uuid();
  getDb()
    .prepare(
      `INSERT INTO messages (id, conversation_id, user_id, role, content, slot_index, revision, parent_message_id, status, meta, edited_from, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      id,
      opts.conversationId,
      opts.userId,
      opts.role,
      opts.content,
      opts.slotIndex,
      opts.revision,
      opts.parentMessageId ?? null,
      opts.status ?? "normal",
      opts.meta ? JSON.stringify(opts.meta) : null,
      opts.editedFrom ?? null,
      nowIso(),
    );
  return id;
}

export function updateMessageContent(id: string, content: string, status: MessageStatus, meta?: MessageMeta | null) {
  getDb()
    .prepare("UPDATE messages SET content = ?, status = ?, meta = COALESCE(?, meta) WHERE id = ?")
    .run(content, status, meta ? JSON.stringify(meta) : null, id);
}

export function setMessageStatus(id: string, status: MessageStatus) {
  getDb().prepare("UPDATE messages SET status = ? WHERE id = ?").run(status, id);
}

/**
 * 用户编辑 slot 之后（FR-02 ①③）：把该 slot 之后仍为 normal 的 AI 回答标记为 stale
 * （基于旧提问内容的回答，折叠展示、可单独重生成；用户消息不受影响）
 */
export function markStaleAfter(conversationId: string, slotIndex: number) {
  getDb()
    .prepare(
      `UPDATE messages SET status = 'stale'
       WHERE conversation_id = ? AND slot_index > ? AND role = 'assistant' AND status = 'normal'`,
    )
    .run(conversationId, slotIndex);
}

/** 清理该 slot 当前 revision 之外残留的 streaming 状态 */
export function clearStreamingStatus(conversationId: string) {
  getDb()
    .prepare("UPDATE messages SET status = 'incomplete' WHERE conversation_id = ? AND status = 'streaming'")
    .run(conversationId);
}
