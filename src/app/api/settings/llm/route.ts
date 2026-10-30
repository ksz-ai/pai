import { NextRequest, NextResponse } from "next/server";
import { getLlmSettings, saveLlmSettings, getSetting, setSetting } from "@/lib/db/repo/settings";
import { llmEnv, fastModel, backupModel } from "@/lib/llm/client";
import { KNOWN_PERSONAS } from "@/lib/llm/prompts/explain";

const PERSONA_DEFAULT = "general";

interface LlmConfigDTO {
  configured: boolean;
  source: "db" | "env" | "none";
  base_url: string;
  model: string;
  fast_model: string;
  backup_model: string;
  api_key_masked: string | null;
  token_budget: number;
  tutor_persona: string;
}

/** 当前生效的模型配置（DB 优先，env 兜底）。Key 只回掩码，不回明文。 */
export async function GET() {
  const db = getLlmSettings();
  const env = llmEnv();
  const fromDb = Boolean(db.base_url && db.api_key && db.model);
  const fromEnv = !fromDb && Boolean(env);

  const mask = (key: string) => (key.length > 8 ? `${key.slice(0, 3)}••••${key.slice(-4)}` : "••••");

  const dto: LlmConfigDTO = {
    configured: Boolean(env),
    source: fromDb ? "db" : fromEnv ? "env" : "none",
    base_url: env?.baseUrl ?? db.base_url ?? "",
    model: env?.model ?? db.model ?? "",
    fast_model: fastModel() || "",
    backup_model: backupModel() ?? "",
    api_key_masked: db.api_key ? mask(db.api_key) : env ? mask(env.apiKey) : null,
    token_budget: Number(getSetting("token_budget") ?? "") || 60_000,
    tutor_persona: getSetting("tutor_persona") ?? PERSONA_DEFAULT,
  };
  return NextResponse.json(dto);
}

/** 保存配置（PRD E-13：保存即生效，无需重启）。api_key 留空表示保留已保存的 Key。 */
export async function PUT(req: NextRequest) {
  const body = (await req.json()) as {
    base_url?: string;
    api_key?: string;
    model?: string;
    fast_model?: string;
    backup_model?: string;
    token_budget?: number;
    tutor_persona?: string;
  };
  if (!body.base_url?.trim() || !body.model?.trim()) {
    return NextResponse.json({ error: "服务地址与模型名不能为空" }, { status: 400 });
  }
  saveLlmSettings({
    base_url: body.base_url,
    model: body.model,
    api_key: body.api_key, // 空则保留
    fast_model: body.fast_model,
    backup_model: body.backup_model,
  });
  if (typeof body.token_budget === "number" && Number.isFinite(body.token_budget)) {
    const budget = Math.min(1_000_000, Math.max(1000, Math.round(body.token_budget)));
    setSetting("token_budget", String(budget));
  }
  if (typeof body.tutor_persona === "string") {
    const p = body.tutor_persona.trim();
    if (p === PERSONA_DEFAULT || KNOWN_PERSONAS.includes(p)) setSetting("tutor_persona", p);
  }
  return NextResponse.json({ ok: true });
}
