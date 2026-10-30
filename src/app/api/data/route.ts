import { NextResponse } from "next/server";
import { getDefaultUserId } from "@/lib/db";
import { wipeAllData } from "@/lib/db/repo/ailogs";

/** 彻底删除全部数据（PRD §11 用户权利） */
export async function DELETE() {
  const userId = getDefaultUserId();
  wipeAllData(userId);
  return NextResponse.json({ ok: true });
}
