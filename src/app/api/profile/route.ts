import { NextResponse } from "next/server";
import { getDefaultUserId } from "@/lib/db";
import { settleDecay } from "@/lib/profile/engine";
import { listEntries } from "@/lib/db/repo/profile";

export async function GET() {
  const userId = getDefaultUserId();
  settleDecay(userId);
  return NextResponse.json(listEntries(userId));
}
