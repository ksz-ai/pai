import { getDb, nowIso } from "@/lib/db";

/**
 * 应用配置 kv 存储（PRD E-13：设置页填入 Key 后立即恢复，无需重启）。
 * 注意：模型配置不属于学习数据，数据清空（wipe）与导出均不涉及此表。
 */

export interface LlmSettings {
  base_url: string;
  api_key: string;
  model: string;
  fast_model: string;
  backup_model: string;
}

const KEYS: Record<keyof LlmSettings, string> = {
  base_url: "llm_base_url",
  api_key: "llm_api_key",
  model: "llm_model",
  fast_model: "llm_fast_model",
  backup_model: "llm_backup_model",
};

export function getLlmSettings(): Partial<LlmSettings> {
  const db = getDb();
  const out: Partial<LlmSettings> = {};
  for (const [field, key] of Object.entries(KEYS) as [keyof LlmSettings, string][]) {
    const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
    if (row?.value) out[field] = row.value;
  }
  return out;
}

/** api_key 为空字符串/undefined 表示保留原值（用户只想改模型时不必重输 Key） */
export function saveLlmSettings(input: Partial<LlmSettings>) {
  const db = getDb();
  const upsert = db.prepare(
    "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  );
  const run = db.transaction(() => {
    for (const [field, key] of Object.entries(KEYS) as [keyof LlmSettings, string][]) {
      const value = input[field];
      if (typeof value === "string" && value.trim()) {
        upsert.run(key, value.trim(), nowIso());
      }
    }
  });
  run();
}

export function clearLlmSettings() {
  const db = getDb();
  db.prepare("DELETE FROM settings WHERE key IN ('llm_base_url','llm_api_key','llm_model','llm_fast_model','llm_backup_model')").run();
}

/** 通用 kv 读取（Token 预算等应用配置） */
export function getSetting(key: string): string | null {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string) {
  getDb()
    .prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
    .run(key, value, nowIso());
}

const DEFAULT_TOKEN_BUDGET = 60_000;

/** 单会话 Token 预算（FR-09 ①，可在设置页调整） */
export function tokenBudget(): number {
  const raw = getSetting("token_budget");
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 1000 ? n : DEFAULT_TOKEN_BUDGET;
}

/** 用户自定义分类标签（分类体系优化）：独立于自动归类的领域，空标签也持久存在 */
export function getCustomDomains(): string[] {
  const raw = getSetting("custom_domains");
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function addCustomDomain(name: string) {
  const trimmed = name.trim().slice(0, 24);
  if (!trimmed) return;
  const list = getCustomDomains();
  if (!list.includes(trimmed)) {
    list.push(trimmed);
    setSetting("custom_domains", JSON.stringify(list));
  }
}
