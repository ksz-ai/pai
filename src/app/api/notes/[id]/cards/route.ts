import { NextRequest, NextResponse } from "next/server";
import { getDefaultUserId } from "@/lib/db";
import { getNote } from "@/lib/db/repo/notes";
import { extractCards } from "@/lib/notes/cards";

type Ctx = { params: Promise<{ id: string }> };

/** 某篇笔记的复习卡片（核心概念 + 术语表，无 LLM） */
export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const note = getNote(id, getDefaultUserId());
  if (!note) return NextResponse.json({ error: "笔记不存在" }, { status: 404 });
  const cards = extractCards(note.content);
  return NextResponse.json({ cards, title: note.title, domain: note.domain });
}
