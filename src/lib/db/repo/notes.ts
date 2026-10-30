import { getDb, nowIso, uuid } from "@/lib/db";
import { classifyDomain, syncNoteConcepts } from "@/lib/notes/classify";
import { addCustomDomain } from "@/lib/db/repo/settings";
import type { NoteAnchor, NoteDTO } from "@/lib/types";

interface NoteRow {
  id: string;
  user_id: string;
  conversation_id: string | null;
  source_conversation_id: string | null;
  source_title: string | null;
  title: string;
  content: string;
  anchors: string;
  status: NoteDTO["status"];
  version: number;
  domain: string;
  domain_locked: number;
  created_at: string;
  updated_at: string;
}

/** anchors v1（[{slot}]，单会话）→ v2（[{id, conversation_id, slot}]）读取兼容 */
function parseAnchors(raw: string, fallbackConvId: string | null): NoteAnchor[] {
  const arr = JSON.parse(raw || "[]") as Array<{ slot: number; id?: string; conversation_id?: string | null }>;
  return arr.map((a, i) =>
    a.id
      ? { id: a.id, conversation_id: a.conversation_id ?? null, slot: a.slot }
      : { id: `a${i + 1}`, conversation_id: fallbackConvId, slot: a.slot },
  );
}

function toDTO(r: NoteRow, listMode = false): NoteDTO {
  const fallbackConvId = r.conversation_id ?? r.source_conversation_id;
  return {
    id: r.id,
    title: r.title,
    content: listMode ? "" : r.content,
    anchors: parseAnchors(r.anchors, fallbackConvId),
    status: r.status,
    version: r.version,
    domain: r.domain ?? "未分类",
    domain_locked: Boolean(r.domain_locked),
    conversation_id: r.conversation_id,
    source_conversation_id: r.source_conversation_id,
    source_title: r.source_title,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export interface ListNotesOpts {
  q?: string;
  domain?: string;
  sort?: "updated" | "created";
  /** 需要正文时开启（默认列表态为省流量不带 content） */
  withContent?: boolean;
}

export function listNotes(userId: string, opts: ListNotesOpts = {}): NoteDTO[] {
  const conditions = ["user_id = ?"];
  const params: string[] = [userId];
  if (opts.domain) {
    conditions.push("domain = ?");
    params.push(opts.domain);
  }
  if (opts.q) {
    // LIKE 扫描（含术语表/正文）。当前规模毫秒级；规模化后可升级 FTS5（中文分词需定制 tokenizer）
    const escaped = opts.q.replace(/[\\%_]/g, (m) => "\\" + m);
    conditions.push("(title LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\' OR source_title LIKE ? ESCAPE '\\')");
    const like = `%${escaped}%`;
    params.push(like, like, like);
  }
  const order = opts.sort === "created" ? "created_at DESC" : "updated_at DESC";
  const rows = getDb()
    .prepare(`SELECT * FROM notes WHERE ${conditions.join(" AND ")} ORDER BY ${order}`)
    .all(...params) as unknown as NoteRow[];
  return rows.map((r) => toDTO(r, !opts.withContent));
}

export function getNote(id: string, userId: string): NoteDTO | undefined {
  const row = getDb().prepare("SELECT * FROM notes WHERE id = ? AND user_id = ?").get(id, userId) as NoteRow | undefined;
  return row ? toDTO(row) : undefined;
}

export function createNote(opts: {
  userId: string;
  conversationId: string | null;
  sourceTitle: string | null;
  title: string;
  content: string;
  anchors: NoteAnchor[];
}): NoteDTO {
  const id = uuid();
  const ts = nowIso();
  const domain = classifyDomain(opts.content);
  getDb()
    .prepare(
      `INSERT INTO notes (id, user_id, conversation_id, source_conversation_id, source_title, title, content, anchors, status, version, domain, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,'draft',1,?,?,?)`,
    )
    .run(id, opts.userId, opts.conversationId, opts.conversationId, opts.sourceTitle, opts.title, opts.content, JSON.stringify(opts.anchors), domain, ts, ts);
  syncNoteConcepts(id, opts.content);
  return getNote(id, opts.userId)!;
}

/** 覆盖前把当前版本存入历史（E-11：另一窗口的修改以历史版本保留） */
function snapshotNote(note: NoteRow) {
  getDb()
    .prepare("INSERT INTO note_versions (id, note_id, version, content, created_at) VALUES (?,?,?,?,?)")
    .run(uuid(), note.id, note.version, note.content, nowIso());
}

/** 笔记内容写入（编辑/追加/合并共用）：版本递增、领域与概念关系同步、旧版本留档 */
function writeContent(id: string, userId: string, content: string) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM notes WHERE id = ? AND user_id = ?").get(id, userId) as NoteRow | undefined;
  if (!row) throw new Error("笔记不存在");
  snapshotNote(row);
  const titleMatch = content.match(/^#\s+(.+)$/m);
  const domain = row.domain_locked ? row.domain : classifyDomain(content);
  db.prepare("UPDATE notes SET content = ?, title = COALESCE(?, title), domain = ?, version = version + 1, updated_at = ? WHERE id = ? AND user_id = ?")
    .run(content, titleMatch ? titleMatch[1].trim() : null, domain, nowIso(), id, userId);
  syncNoteConcepts(id, content);
}

/** 笔记二次编辑（FR-05 ⑥）：版本递增，不回写对话 */
export function updateNoteContent(id: string, userId: string, content: string) {
  writeContent(id, userId, content);
}

export function markExported(id: string, userId: string) {
  getDb().prepare("UPDATE notes SET status = 'exported', updated_at = ? WHERE id = ? AND user_id = ?").run(nowIso(), id, userId);
}

export function deleteNote(id: string, userId: string) {
  const db = getDb();
  db.prepare("DELETE FROM note_versions WHERE note_id = ?").run(id);
  db.prepare("DELETE FROM note_concepts WHERE note_id = ?").run(id);
  db.prepare("DELETE FROM review_logs WHERE note_id = ?").run(id);
  db.prepare("DELETE FROM notes WHERE id = ? AND user_id = ?").run(id, userId);
}

/** 供锚点 v2 写路径复用：带显式 anchors 的内容更新（追加/合并） */
export function writeNoteWithAnchors(id: string, userId: string, content: string, anchors: NoteAnchor[], opts?: { reclassify?: boolean }) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM notes WHERE id = ? AND user_id = ?").get(id, userId) as NoteRow | undefined;
  if (!row) throw new Error("笔记不存在");
  snapshotNote(row);
  const titleMatch = content.match(/^#\s+(.+)$/m);
  const domain = row.domain_locked || opts?.reclassify === false ? row.domain : classifyDomain(content);
  db.prepare("UPDATE notes SET content = ?, anchors = ?, title = COALESCE(?, title), domain = ?, version = version + 1, updated_at = ? WHERE id = ? AND user_id = ?")
    .run(content, JSON.stringify(anchors), titleMatch ? titleMatch[1].trim() : null, domain, nowIso(), id, userId);
  syncNoteConcepts(id, content);
}

/** 用户手动设置领域（分类体系优化）：锁定，自动归类不再覆盖；再次设置即更换。新分类名登记为自定义标签 */
export function setNoteDomain(id: string, userId: string, domain: string) {
  const trimmed = domain.trim().slice(0, 24);
  if (!trimmed) throw new Error("领域名不能为空");
  getDb()
    .prepare("UPDATE notes SET domain = ?, domain_locked = 1, updated_at = ? WHERE id = ? AND user_id = ?")
    .run(trimmed, nowIso(), id, userId);
  addCustomDomain(trimmed);
}
