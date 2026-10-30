import { getDb } from "@/lib/db";

/**
 * 笔记归类（N1）：内容与 concepts 匹配 → 领域 + 笔记↔概念关系。
 * 匹配逻辑与 note_touch 信号一致（content 包含概念名）。
 */

/** 取内容命中概念的主领域：优先有领域的概念，同级取最长名（更具体）；无命中 → 未分类 */
export function classifyDomain(content: string): string {
  const hit = getDb()
    .prepare(
      `SELECT domain FROM concepts WHERE instr(?, name) > 0
       ORDER BY (domain != '未分类') DESC, length(name) DESC LIMIT 1`,
    )
    .get(content) as { domain: string } | undefined;
  return hit?.domain ?? "未分类";
}

/** 重建笔记↔概念关系（生成/编辑/术语表变更后调用） */
export function syncNoteConcepts(noteId: string, content: string) {
  const db = getDb();
  db.prepare("DELETE FROM note_concepts WHERE note_id = ?").run(noteId);
  const hits = db.prepare("SELECT id FROM concepts WHERE instr(?, name) > 0").all(content) as { id: string }[];
  const ins = db.prepare("INSERT OR IGNORE INTO note_concepts (note_id, concept_id) VALUES (?, ?)");
  for (const c of hits) ins.run(noteId, c.id);
}
