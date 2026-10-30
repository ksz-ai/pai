import { getDb, nowIso } from "@/lib/db";
import * as profileRepo from "@/lib/db/repo/profile";
import * as messagesRepo from "@/lib/db/repo/messages";
import type { DepthLevel, EvidenceRef, FeedbackKind } from "@/lib/types";

/**
 * 画像引擎：PRD FR-03 ②③ / FR-04 / FR-08 的业务规则集中地。
 * 所有掌握度变化都过这里，并全量写 profile_logs（AC-08-2）。
 */

export interface EvidenceSnippet {
  slot: number;
  role: "user" | "assistant";
  excerpt: string;
}

/** 判档（FR-03 ②）：<0.3 → L0；0.3–0.7 → L1；≥0.7 → L2 只讲增量；无记录 → L1 默认档 */
export function decideDepth(mastery: number | null): DepthLevel {
  if (mastery === null) return 1;
  if (mastery < 0.3) return 0;
  if (mastery < 0.7) return 1;
  return 2;
}

const clampMastery = (v: number) => Math.min(0.95, Math.max(0.1, Math.round(v * 100) / 100));
/** 单次更新幅度上限 0.2（FR-08） */
const clampStep = (delta: number) => Math.max(-0.2, Math.min(0.2, delta));

export interface SignalResult {
  ok: boolean;
  skipped?: "protected";
  oldValue: number;
  newValue: number;
}

/** 信号驱动掌握度变化。保护期内（用户手动设定后 30 天）系统信号不覆盖（FR-04 ③ / E-06）。 */
export function applySignalDelta(
  entryId: string,
  delta: number,
  signalType: string,
  detail?: string,
  opts?: { bypassProtection?: boolean },
): SignalResult {
  const entry = profileRepo.getEntry(entryId, entryBelongsTo(entryId));
  if (!entry) throw new Error("画像条目不存在");
  if (
    !opts?.bypassProtection &&
    entry.protected_until &&
    entry.protected_until > nowIso()
  ) {
    profileRepo.insertLog(entryId, entry.mastery, entry.mastery, "protected_skip", `系统信号（${signalType}）被保护期拦截`);
    return { ok: false, skipped: "protected", oldValue: entry.mastery, newValue: entry.mastery };
  }
  const newValue = clampMastery(entry.mastery + clampStep(delta));
  profileRepo.updateEntryMastery(entryId, newValue);
  profileRepo.touchEntry(entryId);
  profileRepo.insertLog(entryId, entry.mastery, newValue, signalType, detail);
  return { ok: true, oldValue: entry.mastery, newValue };
}

function entryBelongsTo(entryId: string): string {
  const row = getDb().prepare("SELECT user_id FROM profile_entries WHERE id = ?").get(entryId) as { user_id: string } | undefined;
  if (!row) throw new Error("画像条目不存在");
  return row.user_id;
}

/**
 * 提问信号（FR-08 ①）："什么是 X" 类提问 → X 记为低掌握。
 * 概念不存在则创建（初始 0.3，FR-03 ③），已存在则 touch 并追加证据。
 */
export function ensureEntryFromAsk(opts: {
  userId: string;
  name: string;
  domain?: string;
  isMain: boolean;
  evidence: EvidenceRef;
}): { created: boolean; entryId: string; mastery: number } {
  const existing = profileRepo.findEntryByConceptName(opts.userId, opts.name);
  if (existing) {
    profileRepo.addEvidence(existing.id, opts.evidence);
    profileRepo.touchEntry(existing.id);
    profileRepo.insertLog(existing.id, existing.mastery, existing.mastery, "ask_touch", `提问涉及「${opts.name}」`);
    return { created: false, entryId: existing.id, mastery: existing.mastery };
  }
  const concept = profileRepo.upsertConcept(opts.name, opts.domain);
  const entryId = profileRepo.insertEntry({
    userId: opts.userId,
    conceptId: concept.id,
    mastery: 0.3,
    evidence: [opts.evidence],
  });
  profileRepo.insertLog(entryId, null, 0.3, "ask_new", `首次提问「${opts.name}」，初始掌握度 0.3`);
  return { created: true, entryId, mastery: 0.3 };
}

/** 深度反馈信号（FR-03 ④ / FR-08 ②）：太啰嗦 +0.15（此前低估），再详细些 -0.15（此前高估） */
export function applyFeedbackSignal(userId: string, conceptName: string, feedback: FeedbackKind): SignalResult | null {
  if (feedback === "rephrase") return null;
  const entry = profileRepo.findEntryByConceptName(userId, conceptName);
  if (!entry) return null;
  const delta = feedback === "too_verbose" ? 0.15 : -0.15;
  return applySignalDelta(entry.id, delta, `feedback_${feedback}`, `深度反馈：${feedback === "too_verbose" ? "太啰嗦" : "再详细些"}`);
}

/** 手动纠错（FR-04 ③）：权重最高，30 天保护期不被系统推断覆盖 */
export function userAdjustMastery(userId: string, entryId: string, newValue: number): number {
  const entry = profileRepo.getEntry(entryId, userId);
  if (!entry) throw new Error("画像条目不存在");
  const value = clampMastery(newValue);
  const protectedUntil = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
  profileRepo.updateEntryMastery(entryId, value, { sourceType: "user", protectedUntil });
  profileRepo.touchEntry(entryId);
  profileRepo.insertLog(entryId, entry.mastery, value, "user_edit", "用户手动设定，30 天保护期");
  return value;
}

export function userDeleteEntry(userId: string, entryId: string) {
  const entry = profileRepo.getEntry(entryId, userId);
  if (!entry) throw new Error("画像条目不存在");
  profileRepo.insertLog(entryId, entry.mastery, null, "user_delete", "用户删除条目");
  profileRepo.deleteEntry(entryId);
}

/** 衰减惰性结算（FR-03 ③）：90 天未接触 -0.1，下限 0.1。读取画像前调用，代替定时任务。 */
export function settleDecay(userId: string) {
  const threshold = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
  for (const entry of profileRepo.entriesTouchedBefore(userId, threshold)) {
    // 保护期内不衰减
    if (entry.protected_until && entry.protected_until > nowIso()) continue;
    const newValue = clampMastery(Math.max(0.1, entry.mastery - 0.1));
    profileRepo.updateEntryMastery(entry.id, newValue);
    profileRepo.touchEntry(entry.id);
    profileRepo.insertLog(entry.id, entry.mastery, newValue, "decay", "90 天未接触，掌握度衰减 0.1");
  }
}

/** 从证据引用加载原文片段（≤3 条，每条截断 200 字），用于讲解时注入（方案 C 溯源）。 */
export function loadEvidenceSnippets(userId: string, entryId: string): EvidenceSnippet[] {
  const entry = profileRepo.getEntry(entryId, userId);
  if (!entry) return [];
  const refs = JSON.parse(entry.evidence_refs || "[]") as EvidenceRef[];
  const snippets: EvidenceSnippet[] = [];
  for (const ref of refs.slice(-3).reverse()) {
    const msg = messagesRepo.getMessage(ref.id);
    if (!msg) continue;
    snippets.push({
      slot: ref.slot,
      role: msg.role,
      excerpt: msg.content.replace(/\s+/g, " ").slice(0, 200),
    });
    if (snippets.length >= 3) break;
  }
  return snippets;
}
