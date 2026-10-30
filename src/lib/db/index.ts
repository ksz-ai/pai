import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const DB_PATH = process.env.PAI_DB_PATH ?? path.join(process.cwd(), "data", "pai.db");

declare global {
  var __paiDb: Database.Database | undefined;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  nickname TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '新会话',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  token_used INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_conv_user ON conversations(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content TEXT NOT NULL,
  slot_index INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  parent_message_id TEXT,
  status TEXT NOT NULL DEFAULT 'normal' CHECK (status IN ('normal','streaming','incomplete','stale')),
  meta TEXT,
  edited_from TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_msg_conv_slot ON messages(conversation_id, slot_index, revision);

CREATE TABLE IF NOT EXISTS concepts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  aliases TEXT NOT NULL DEFAULT '[]',
  domain TEXT NOT NULL DEFAULT '未分类',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS profile_entries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  concept_id TEXT NOT NULL,
  mastery REAL NOT NULL DEFAULT 0.3 CHECK (mastery >= 0 AND mastery <= 1),
  source_type TEXT NOT NULL DEFAULT 'system' CHECK (source_type IN ('system','user')),
  evidence_refs TEXT NOT NULL DEFAULT '[]',
  last_touched_at TEXT NOT NULL,
  protected_until TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, concept_id)
);

CREATE TABLE IF NOT EXISTS profile_logs (
  id TEXT PRIMARY KEY,
  profile_entry_id TEXT NOT NULL,
  old_value REAL,
  new_value REAL,
  signal_type TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_plog_entry ON profile_logs(profile_entry_id, created_at DESC);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  conversation_id TEXT,
  source_conversation_id TEXT,
  source_title TEXT,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  anchors TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','exported','source_deleted')),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  scene TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  token_in INTEGER NOT NULL DEFAULT 0,
  token_out INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ok',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS selection_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  note_id TEXT NOT NULL,
  selected_text TEXT NOT NULL,
  term_matched INTEGER NOT NULL DEFAULT 0,
  action TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS note_versions (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS note_concepts (
  note_id TEXT NOT NULL,
  concept_id TEXT NOT NULL,
  PRIMARY KEY (note_id, concept_id)
);

CREATE TABLE IF NOT EXISTS review_logs (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL,
  concept_name TEXT NOT NULL,
  grade TEXT NOT NULL CHECK (grade IN ('known','unknown')),
  created_at TEXT NOT NULL
);
`;

function migrate(db: Database.Database) {
  // notes.domain 列（笔记管理 N1：领域归类）
  const cols = (db.prepare("PRAGMA table_info(notes)").all() as { name: string }[]).map((c) => c.name);
  if (cols.length > 0 && !cols.includes("domain")) {
    db.exec("ALTER TABLE notes ADD COLUMN domain TEXT NOT NULL DEFAULT '未分类'");
  }
  // domain_locked 列（分类体系优化：用户手动设置后锁定，不被自动归类覆盖）
  if (cols.length > 0 && !cols.includes("domain_locked")) {
    db.exec("ALTER TABLE notes ADD COLUMN domain_locked INTEGER NOT NULL DEFAULT 0");
  }

  // 概念领域传播：未分类概念从"包含它且已归类"的笔记继承领域（幂等，只动未分类）
  db.exec(`
    UPDATE concepts SET domain = (
      SELECT n.domain FROM notes n
      WHERE instr(n.content, concepts.name) > 0 AND n.domain != '未分类'
      ORDER BY n.updated_at DESC LIMIT 1
    )
    WHERE domain = '未分类' AND EXISTS (
      SELECT 1 FROM notes n WHERE instr(n.content, concepts.name) > 0 AND n.domain != '未分类'
    )
  `);

  // 未锁定笔记重算领域（概念领域已传播，规则同 classify：优先非未分类 + 最长名）
  db.exec(`
    UPDATE notes SET domain = COALESCE((
      SELECT c.domain FROM concepts c WHERE instr(notes.content, c.name) > 0
      ORDER BY (c.domain != '未分类') DESC, length(c.name) DESC LIMIT 1
    ), '未分类')
    WHERE domain_locked = 0
  `);
  db.exec(`
    INSERT OR IGNORE INTO note_concepts (note_id, concept_id)
    SELECT n.id, c.id FROM notes n JOIN concepts c ON instr(n.content, c.name) > 0
  `);

  // 锚点 v1 → v2（笔记管理 N2）：[[mN]] → [[aK]]，anchors 补 conversation_id（跨会话合并的前置）
  const legacy = db
    .prepare("SELECT id, content, anchors, conversation_id, source_conversation_id FROM notes")
    .all() as Array<{ id: string; content: string; anchors: string; conversation_id: string | null; source_conversation_id: string | null }>;
  for (const n of legacy) {
    const arr = JSON.parse(n.anchors || "[]") as Array<{ slot: number; id?: string }>;
    if (arr.length > 0 && arr[0].id) continue; // 已是 v2
    const convId = n.conversation_id ?? n.source_conversation_id;
    const slotToId = new Map<number, string>();
    const content = String(n.content).replace(/\[\[m(\d+)\]\]/g, (_m, num: string) => {
      const slot = Number(num);
      if (!slotToId.has(slot)) slotToId.set(slot, `a${slotToId.size + 1}`);
      return `[[${slotToId.get(slot)}]]`;
    });
    for (const a of arr) if (!slotToId.has(a.slot)) slotToId.set(a.slot, `a${slotToId.size + 1}`);
    const anchors = [...slotToId.entries()].map(([slot, id]) => ({ id, conversation_id: convId, slot }));
    if (content === n.content && anchors.length === arr.length) continue; // 无 token 也无锚点，跳过
    db.prepare("UPDATE notes SET content = ?, anchors = ? WHERE id = ?").run(content, JSON.stringify(anchors), n.id);
  }
}

function open(): Database.Database {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);
  migrate(db);
  ensureDefaultUser(db);
  return db;
}

function ensureDefaultUser(db: Database.Database) {
  const row = db.prepare("SELECT id FROM users LIMIT 1").get() as { id: string } | undefined;
  if (!row) {
    db.prepare("INSERT INTO users (id, nickname, created_at) VALUES (?, ?, ?)").run(
      randomUUID(),
      "学习者",
      new Date().toISOString(),
    );
  }
}

/** 获取全局单例连接（开发热更新下复用） */
export function getDb(): Database.Database {
  if (!globalThis.__paiDb) globalThis.__paiDb = open();
  return globalThis.__paiDb;
}

export function getDefaultUserId(): string {
  const row = getDb().prepare("SELECT id FROM users LIMIT 1").get() as { id: string } | undefined;
  if (!row) throw new Error("默认用户不存在");
  return row.id;
}

export const nowIso = () => new Date().toISOString();
export const uuid = () => randomUUID();
