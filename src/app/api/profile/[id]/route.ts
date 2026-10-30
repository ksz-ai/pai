import { NextRequest, NextResponse } from "next/server";
import { getDefaultUserId } from "@/lib/db";
import { userAdjustMastery, userDeleteEntry } from "@/lib/profile/engine";

type Ctx = { params: Promise<{ id: string }> };

/** 手动纠错（FR-04 ③）：掌握度调整，权重最高 + 30 天保护期 */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const userId = getDefaultUserId();
  const body = (await req.json()) as { mastery?: number };
  if (typeof body.mastery !== "number" || body.mastery < 0 || body.mastery > 1) {
    return NextResponse.json({ error: "mastery 需在 0–1 之间" }, { status: 400 });
  }
  try {
    const value = userAdjustMastery(userId, id, body.mastery);
    return NextResponse.json({ ok: true, mastery: value });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "操作失败" }, { status: 404 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const userId = getDefaultUserId();
  try {
    userDeleteEntry(userId, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "操作失败" }, { status: 404 });
  }
}
