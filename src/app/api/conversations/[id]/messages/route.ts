import { NextRequest, NextResponse } from "next/server";
import { revisionsOfSlot } from "@/lib/db/repo/messages";

type Ctx = { params: Promise<{ id: string }> };

/** GET ?slot=N：该 slot 的全部版本（查看历史版本，FR-02 ②） */
export async function GET(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const slot = Number(new URL(req.url).searchParams.get("slot"));
  if (!Number.isInteger(slot)) return NextResponse.json({ error: "slot 参数无效" }, { status: 400 });
  return NextResponse.json(revisionsOfSlot(id, slot));
}
