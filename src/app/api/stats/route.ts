import { NextResponse } from "next/server";
import { getDb, getDefaultUserId } from "@/lib/db";
import { stats } from "@/lib/db/repo/ailogs";

export async function GET() {
  const userId = getDefaultUserId();
  return NextResponse.json(stats(userId));
}

/** 一键导出全部数据（PRD §11 用户权利：JSON 全量） */
export async function POST() {
  const userId = getDefaultUserId();
  const db = getDb();
  const dump = {
    exported_at: new Date().toISOString(),
    user: db.prepare("SELECT id, nickname, created_at FROM users WHERE id = ?").get(userId),
    conversations: db.prepare("SELECT * FROM conversations WHERE user_id = ?").all(userId),
    messages: db.prepare("SELECT id, conversation_id, role, content, slot_index, revision, status, meta, created_at FROM messages WHERE user_id = ?").all(userId),
    notes: db.prepare("SELECT * FROM notes WHERE user_id = ?").all(userId),
    profile_entries: db.prepare("SELECT * FROM profile_entries WHERE user_id = ?").all(userId),
    concepts: db.prepare("SELECT * FROM concepts").all(),
    profile_logs: db.prepare("SELECT * FROM profile_logs").all(),
    ai_logs: db.prepare("SELECT * FROM ai_logs WHERE user_id = ?").all(userId),
  };
  return NextResponse.json(dump);
}
