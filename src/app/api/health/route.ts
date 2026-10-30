import { NextResponse } from "next/server";
import { llmEnv, fastModel, backupModel } from "@/lib/llm/client";
import { getDb } from "@/lib/db";

export async function GET() {
  const env = llmEnv();
  let dbOk = false;
  try {
    getDb().prepare("SELECT 1").get();
    dbOk = true;
  } catch {
    dbOk = false;
  }
  return NextResponse.json({
    modelConfigured: Boolean(env),
    model: env?.model ?? null,
    fastModel: env ? fastModel() : null,
    backupModel: env ? backupModel() : null,
    db: dbOk ? "ok" : "error",
  });
}
