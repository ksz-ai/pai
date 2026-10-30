import { NextRequest, NextResponse } from "next/server";
import { getDb, getDefaultUserId, nowIso, uuid } from "@/lib/db";
import { getNote } from "@/lib/db/repo/notes";
import { applySignalDelta } from "@/lib/profile/engine";
import * as profileRepo from "@/lib/db/repo/profile";

/**
 * 复习自评（C）：会 → 掌握度 +0.1；不会 → −0.15。
 * 复用画像信号管道（保护期、单次上限、全量日志继承）；无画像条目时仅记录复习日志。
 */
export async function POST(req: NextRequest) {
  const userId = getDefaultUserId();
  const body = (await req.json()) as { note_id?: string; concept_name?: string; grade?: "known" | "unknown" };
  if (!body.note_id || !body.concept_name?.trim() || !body.grade) {
    return NextResponse.json({ error: "note_id、concept_name、grade 必填" }, { status: 400 });
  }
  const note = getNote(body.note_id, userId);
  if (!note) return NextResponse.json({ error: "笔记不存在" }, { status: 404 });

  const db = getDb();
  db.prepare("INSERT INTO review_logs (id, note_id, concept_name, grade, created_at) VALUES (?,?,?,?,?)").run(
    uuid(),
    body.note_id,
    body.concept_name.trim(),
    body.grade,
    nowIso(),
  );

  const entry = profileRepo.findEntryByConceptName(userId, body.concept_name);
  if (!entry) {
    return NextResponse.json({ ok: true, masteryChanged: false });
  }
  const delta = body.grade === "known" ? 0.1 : -0.15;
  const result = applySignalDelta(entry.id, delta, `review_${body.grade}`, `复习自评「${body.concept_name}」（笔记《${note.title}》）`);
  return NextResponse.json({
    ok: true,
    masteryChanged: result.ok,
    skipped: result.skipped === "protected" || undefined,
    mastery: result.newValue,
  });
}
