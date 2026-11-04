import { NextResponse } from "next/server";
import { getDb, getDefaultUserId } from "@/lib/db";

/** 知识图谱数据（SPEC M2-2）：节点=概念（掌握度/证据/笔记），边=同笔记共现 */
export async function GET() {
  const userId = getDefaultUserId();
  const db = getDb();

  // 节点：有画像条目或被笔记引用的概念
  const nodes = db
    .prepare(
      `SELECT c.id, c.name, c.domain,
        COALESCE(pe.mastery, 0.3) AS mastery,
        COALESCE(pe.source_type, 'none') AS source,
        (SELECT COUNT(*) FROM notes n2 WHERE n2.id IN (SELECT note_id FROM note_concepts WHERE concept_id = c.id)) AS note_count,
        (SELECT COUNT(*) FROM messages m WHERE m.id IN (
          SELECT je.value FROM profile_entries pe2, json_each(pe2.evidence_refs) je
          WHERE pe2.concept_id = c.id AND pe2.user_id = ?
        )) AS evidence_count
       FROM concepts c
       LEFT JOIN profile_entries pe ON pe.concept_id = c.id AND pe.user_id = ?
       WHERE c.id IN (SELECT concept_id FROM profile_entries WHERE user_id = ?)
          OR c.id IN (SELECT nc.concept_id FROM note_concepts nc JOIN notes n ON n.id = nc.note_id WHERE n.user_id = ?)
       ORDER BY c.name`,
    )
    .all(userId, userId, userId, userId) as Array<{
    id: string;
    name: string;
    domain: string;
    mastery: number;
    source: string;
    note_count: number;
    evidence_count: number;
  }>;

  // 边：同笔记共现的概念对（weight = 共现笔记数）
  const links = db
    .prepare(
      `SELECT a.concept_id AS source, b.concept_id AS target, COUNT(*) AS weight
       FROM note_concepts a
       JOIN note_concepts b ON a.note_id = b.note_id AND a.concept_id < b.concept_id
       JOIN notes n ON n.id = a.note_id
       WHERE n.user_id = ?
       GROUP BY a.concept_id, b.concept_id`,
    )
    .all(userId) as Array<{ source: string; target: string; weight: number }>;

  // 节点的证据引用（跳转用，最多 5 条）
  const evidence = db
    .prepare(
      `SELECT pe.concept_id, je.value ->> '$.conversation_id' AS conversation_id, je.value ->> '$.slot' AS slot
       FROM profile_entries pe, json_each(pe.evidence_refs) je
       WHERE pe.user_id = ?`,
    )
    .all(userId) as Array<{ concept_id: string; conversation_id: string; slot: string }>;

  const notes = db
    .prepare(
      `SELECT nc.concept_id, n.id, n.title FROM note_concepts nc
       JOIN notes n ON n.id = nc.note_id WHERE n.user_id = ?`,
    )
    .all(userId) as Array<{ concept_id: string; id: string; title: string }>;

  return NextResponse.json({
    nodes: nodes.map((n) => ({
      ...n,
      evidence: evidence.filter((e) => e.concept_id === n.id).slice(0, 5),
      relatedNotes: notes.filter((x) => x.concept_id === n.id),
    })),
    links,
  });
}
