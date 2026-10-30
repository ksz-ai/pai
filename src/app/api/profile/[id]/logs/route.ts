import { NextRequest, NextResponse } from "next/server";
import { logsOfEntry } from "@/lib/db/repo/profile";

type Ctx = { params: Promise<{ id: string }> };

/** 变更留痕（AC-08-2：时间、原值、新值、信号类型） */
export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  return NextResponse.json(logsOfEntry(id));
}
