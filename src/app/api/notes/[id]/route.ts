import { NextRequest, NextResponse } from "next/server";
import { getDb, getDefaultUserId } from "@/lib/db";
import { getNote, markExported, updateNoteContent, deleteNote, setNoteDomain } from "@/lib/db/repo/notes";
import { addGlossaryEntry, upsertGlossaryEntry, appendQaToNote } from "@/lib/notes/glossary";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const note = getNote(id, getDefaultUserId());
  if (!note) return NextResponse.json({ error: "笔记不存在" }, { status: 404 });
  return NextResponse.json({ note });
}

/**
 * 笔记更新统一入口：
 * - content：二次编辑（base_version 不匹配且未 force → 409 冲突，E-11）
 * - glossary_add：划词加入术语表（replace=true 时更新已有解释，FR-07 ③）
 * - mark_exported：导出标记
 */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const userId = getDefaultUserId();
  const body = (await req.json()) as {
    content?: string;
    mark_exported?: boolean;
    glossary_add?: { term: string; explanation: string; replace?: boolean };
    append_qa?: { question: string; answer: string };
    base_version?: number;
    force?: boolean;
    domain?: string;
  };

  const note = getNote(id, userId);
  if (!note) return NextResponse.json({ error: "笔记不存在" }, { status: 404 });

  // 与笔记对话 → 存入笔记（M2-3）：问答追加到延伸问题章节
  if (body.append_qa) {
    const { question, answer } = body.append_qa;
    if (!question?.trim() || !answer?.trim()) {
      return NextResponse.json({ error: "问答内容不能为空" }, { status: 400 });
    }
    updateNoteContent(id, userId, appendQaToNote(note.content, question.trim(), answer.trim()));
    return NextResponse.json({ ok: true, note: getNote(id, userId) });
  }

  // 用户自定义分类（分类体系优化）：设置领域并锁定
  if (body.domain !== undefined) {
    if (!body.domain.trim()) return NextResponse.json({ error: "领域名不能为空" }, { status: 400 });
    try {
      setNoteDomain(id, userId, body.domain);
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "设置失败" }, { status: 400 });
    }
    return NextResponse.json({ ok: true, note: getNote(id, userId) });
  }

  // E-11 并发冲突：另一窗口已改过且本次未带 force
  if (
    body.content !== undefined &&
    typeof body.base_version === "number" &&
    body.base_version !== note.version &&
    !body.force
  ) {
    return NextResponse.json(
      { error: "检测到另一窗口的修改，已保留两个版本", conflict: true, note },
      { status: 409 },
    );
  }

  if (body.mark_exported) {
    markExported(id, userId);
    return NextResponse.json({ ok: true, note: getNote(id, userId) });
  }

  if (body.glossary_add) {
    const { term, explanation, replace } = body.glossary_add;
    if (!term?.trim() || !explanation?.trim()) {
      return NextResponse.json({ error: "术语与解释不能为空" }, { status: 400 });
    }
    const next = replace
      ? { content: upsertGlossaryEntry(note.content, term.trim(), explanation.trim()), exists: false }
      : addGlossaryEntry(note.content, term.trim(), explanation.trim());
    updateNoteContent(id, userId, next.content);
    return NextResponse.json({ exists: next.exists, note: getNote(id, userId) });
  }

  if (!body.content?.trim()) return NextResponse.json({ error: "内容不能为空" }, { status: 400 });
  updateNoteContent(id, userId, body.content.trim());
  return NextResponse.json({ note: getNote(id, userId) });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const userId = getDefaultUserId();
  getDb().prepare("DELETE FROM note_versions WHERE note_id = ?").run(id);
  deleteNote(id, userId);
  return NextResponse.json({ ok: true });
}
