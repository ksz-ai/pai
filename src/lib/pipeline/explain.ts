import { chatComplete, chatStream, fastModel, backupModel, llmEnv, parseJsonLoose, type ChatMsg } from "@/lib/llm/client";
import { buildExplainSystemPrompt, EXPLAIN_PROMPT_VERSION, SOCRATIC_RECAP_MARKER } from "@/lib/llm/prompts/explain";
import { buildExtractMessages, EXTRACT_PROMPT_VERSION, type ExtractResult } from "@/lib/llm/prompts/extract";
import { insertAiLog } from "@/lib/db/repo/ailogs";
import * as profileRepo from "@/lib/db/repo/profile";
import * as messagesRepo from "@/lib/db/repo/messages";
import * as conversationsRepo from "@/lib/db/repo/conversations";
import { getSetting, tokenBudget } from "@/lib/db/repo/settings";
import { applyFeedbackSignal, decideDepth, ensureEntryFromAsk, loadEvidenceSnippets, settleDecay } from "@/lib/profile/engine";
import type { DepthLevel, EvidenceRef, FeedbackKind, MessageMeta, SSEEvent } from "@/lib/types";
import { hasDiagramContent } from "@/lib/diagram/markdown";

export interface ExplainOptions {
  userId: string;
  conversationId: string;
  /** 新提问（/api/chat）：问题消息已由路由插入 */
  userMessageId?: string;
  userText?: string;
  userSlot?: number;
  /** 重新生成（/api/chat/regenerate） */
  regen?: {
    assistantMessageId: string;
    slotIndex: number;
    reason: "manual" | "feedback" | "retry" | "edit";
    feedback?: FeedbackKind;
    prevMeta: MessageMeta | null;
  };
  /** 之前的对话历史（role + content，已按 slot 排序） */
  history: { role: "user" | "assistant"; content: string }[];
  abortSignal?: AbortSignal;
}

/** 概念抽取（FR-03 前置检查的入口）。降级链：JSON 模式 → 普通模式 → 抛错由上层正则兜底。 */
async function extractConcepts(
  userId: string,
  question: string,
): Promise<{ concepts: ExtractResult["concepts"]; tokenIn: number; tokenOut: number }> {
  const env = llmEnv()!;
  const known = profileRepo.listConceptNames(80);
  const baseMessages = buildExtractMessages(question, known);
  let result: Awaited<ReturnType<typeof chatComplete>>;

  try {
    result = await chatComplete(env, baseMessages, { model: fastModel(), json: true, timeoutMs: 30_000 });
  } catch (jsonErr) {
    // 部分供应商不支持 response_format: json_object —— 去掉约束重试一次
    try {
      result = await chatComplete(env, baseMessages, { model: fastModel(), timeoutMs: 30_000 });
    } catch {
      throw jsonErr;
    }
  }
  insertAiLog({
    userId,
    scene: "extract",
    model: fastModel(),
    promptVersion: EXTRACT_PROMPT_VERSION,
    tokenIn: result.tokenIn,
    tokenOut: result.tokenOut,
    latencyMs: result.latencyMs,
  });
  const parsed = parseJsonLoose<ExtractResult>(result.content);
  const concepts = (parsed.concepts ?? []).filter((c) => c && typeof c.name === "string" && c.name.trim()).slice(0, 4);
  return { concepts, tokenIn: result.tokenIn, tokenOut: result.tokenOut };
}

/** 本地正则兜底（不花模型调用）："什么是X / X是什么 / 讲讲X / what is X" 等常见提问句式 */
export function localConceptFallback(question: string): ExtractResult["concepts"] {
  const patterns: RegExp[] = [
    /(?:什么是|啥是|讲讲|说说|解释(?:一下)?|介绍(?:一下)?|了解(?:一下)?)\s*([　\s\w\u4e00-\u9fa5]{1,24}?)(?:[的]?.*(?:概念|含义|意思|定义|原理)|[？?。！，,]|$)/,
    /([\u4e00-\u9fa5A-Za-z][\u4e00-\u9fa5A-Za-z0-9 \-]{1,20}?)\s*(?:是什么|是什么意思|的概念|的定义|怎么理解|如何理解)/,
    /what\s+is\s+(?:a\s+|an\s+|the\s+)?([a-z0-9 \-]{2,30})/i,
  ];
  for (const re of patterns) {
    const m = question.match(re);
    if (m?.[1]) {
      const name = m[1].replace(/^(?:一下|下)\s*/, "").trim();
      if (name.length >= 1 && name.length <= 24) return [{ name, is_main: true }];
    }
  }
  return [];
}

function keywordFallback(userId: string, question: string): ExtractResult["concepts"] {
  const entries = profileRepo.listEntries(userId);
  return entries
    .filter((e) => question.includes(e.concept_name))
    .slice(0, 4)
    .map((e) => ({ name: e.concept_name, domain: e.domain, is_main: false }));
}

const HISTORY_LIMIT = 12;
const HISTORY_LIMIT_COMPRESSED = 6;
const HISTORY_MSG_MAX_CHARS = 2000;

/** 单会话 Token 预算检查（FR-09 ②③）：返回压缩标记；超 100% 直接阻断 */
export function budgetState(conversationId: string, userId: string): { blocked: false; compressed: boolean; used: number; budget: number } | { blocked: true; used: number; budget: number } {
  const conv = conversationsRepo.getConversation(conversationId, userId);
  const budget = tokenBudget();
  const used = conv?.token_used ?? 0;
  if (used >= budget) return { blocked: true, used, budget };
  return { blocked: false, compressed: used >= budget * 0.8, used, budget };
}

function buildLlmMessages(system: string, history: ExplainOptions["history"], finalUserText: string, limit: number): ChatMsg[] {
  const msgs: ChatMsg[] = [{ role: "system", content: system }];
  for (const h of history.slice(-limit)) {
    msgs.push({ role: h.role, content: h.content.slice(0, HISTORY_MSG_MAX_CHARS) });
  }
  msgs.push({ role: "user", content: finalUserText.slice(0, 8000) });
  return msgs;
}

/**
 * 自适应讲解主管线（FR-03）：
 * 概念抽取 → 读画像判档 → 组装上下文（画像 Top-K + 证据片段）→ 流式生成 → 画像信号回流。
 */
export async function* explain(opts: ExplainOptions): AsyncGenerator<SSEEvent> {
  const env = llmEnv();
  if (!env) {
    yield { type: "error", code: "no_model", message: "未配置模型服务，请先在设置页完成配置" };
    return;
  }
  const { userId, conversationId } = opts;

  // 1. 预算检查（FR-09 ③）：超 100% 阻断新调用，会话保留可读（E-05）
  const budget = budgetState(conversationId, userId);
  if (budget.blocked) {
    yield {
      type: "error",
      code: "budget_exceeded",
      message: `本次会话累计已用 ${budget.used.toLocaleString()} tokens，超出预算（${budget.budget.toLocaleString()}）。建议开启新会话；当前会话内容仍可阅读与导出。`,
    };
    return;
  }
  const compressed = budget.compressed;

  // 2. 画像惰性衰减结算 + 读取
  settleDecay(userId);

  // 1.5 当前导师人格（苏格拉底续轮检测与 prompt 组装共用）
  const persona = getSetting("tutor_persona") ?? "general";

  // 2. 确定主概念与相关概念（始终尝试抽取——画像就是从这里开始生长的）
  let mainConcept: { name: string; domain?: string } | null = null;
  let relatedConcepts: { name: string; domain?: string }[] = [];
  let extractionFailed = false;

  // 苏格拉底续轮检测（融合批次 F1+）：上一条 AI 回答处于引导中【且当前仍是苏格拉底人格】
  // → 本轮为引导续轮，跳过抽取（复用流程概念，学习者此刻是在回答问题而非新提问）。
  // 人格切走即终止旧流程（避免切回 general 后新提问仍被当作续轮）。
  const lastAssistant = [...opts.history].reverse().find((h) => h.role === "assistant");
  const socraticContinue =
    persona === "socratic" &&
    Boolean(lastAssistant) &&
    (() => {
      // history 不带 meta，需查库取最后一条 assistant 的 meta
      const convMsgs = messagesRepo.activeChain(conversationId);
      const lastAi = [...convMsgs].reverse().find((m) => m.role === "assistant" && m.slot_index < (opts.userSlot ?? Infinity));
      return lastAi?.meta?.persona === "socratic" && lastAi.meta.socratic_state === "guiding" ? lastAi.meta : null;
    })();

  if (socraticContinue) {
    mainConcept = socraticContinue.concept_name
      ? { name: socraticContinue.concept_name, domain: socraticContinue.domain ?? undefined }
      : null;
  } else if (opts.regen?.prevMeta?.concept_name) {
    mainConcept = { name: opts.regen.prevMeta.concept_name, domain: opts.regen.prevMeta.domain ?? undefined };
  } else if (opts.userText) {
    try {
      const { concepts } = await extractConcepts(userId, opts.userText);
      const main = concepts.find((c) => c.is_main) ?? concepts[0];
      if (main) {
        mainConcept = { name: main.name, domain: main.domain };
        relatedConcepts = concepts.filter((c) => c !== main && !c.is_main);
      } else {
        relatedConcepts = concepts;
      }
    } catch {
      extractionFailed = true;
      relatedConcepts = keywordFallback(userId, opts.userText);
    }
    // 相关概念继承主概念领域（消灭"未分类"：抽取 LLM 常只为 is_main 给 domain）
    const mainDomain = mainConcept?.domain;
    if (mainDomain) {
      relatedConcepts = relatedConcepts.map((c) => ({ ...c, domain: c.domain ?? mainDomain }));
    }
    // LLM 抽取失败且关键词无命中：本地正则兜底，保证画像至少记录主概念
    if (extractionFailed && !mainConcept && relatedConcepts.length === 0) {
      const local = localConceptFallback(opts.userText);
      const main = local.find((c) => c.is_main);
      if (main) mainConcept = { name: main.name, domain: undefined };
      relatedConcepts = local.filter((c) => c !== main);
    }
  }

  const mainEntry = mainConcept ? profileRepo.findEntryByConceptName(userId, mainConcept.name) : undefined;
  const relatedEntries = relatedConcepts
    .map((c) => profileRepo.findEntryByConceptName(userId, c.name))
    .filter((e): e is NonNullable<typeof e> => Boolean(e));

  // 3. 判档
  let depth: DepthLevel;
  if (opts.regen?.feedback && opts.regen.prevMeta) {
    const prev = opts.regen.prevMeta.depth;
    depth =
      opts.regen.feedback === "too_verbose"
        ? (Math.max(0, prev - 1) as DepthLevel)
        : opts.regen.feedback === "more_detail"
          ? (Math.min(2, prev + 1) as DepthLevel)
          : prev;
  } else {
    depth = decideDepth(mainEntry ? mainEntry.mastery : null);
  }

  // 4. 前置补齐（FR-03 ① / AC-03-1）：有画像记录且 <0.7 的相关概念先补
  const missingPrereqs = relatedEntries
    .filter((e) => e.mastery < 0.7)
    .slice(0, 3)
    .map((e) => ({ name: e.concept_name, mastery: e.mastery }));

  // 5. 画像注入（FR-09 ②：预算 80% 以上时压缩为 Top-3 并舍弃证据原文）
  const allEntries = [mainEntry, ...relatedEntries].filter((e): e is NonNullable<typeof e> => Boolean(e));
  const usedEntries = (compressed ? allEntries.slice(0, 3) : allEntries.slice(0, 5)).map((e) => ({
    name: e.concept_name,
    mastery: e.mastery,
  }));
  const profileHit = usedEntries.length > 0;

  // 证据片段（方案 C：结构化决策 + 原文溯源）
  const evidence = compressed ? [] : mainEntry ? loadEvidenceSnippets(userId, mainEntry.id) : [];

  // 6. 反馈先行修正画像（FR-03 ④：点击后立即更新）
  let feedbackSignalNote: string | null = null;
  if (opts.regen?.feedback && mainConcept) {
    const result = applyFeedbackSignal(userId, mainConcept.name, opts.regen.feedback);
    if (result) {
      feedbackSignalNote = result.skipped
        ? `「${mainConcept.name}」处于保护期，掌握度保持 ${result.newValue.toFixed(2)}`
        : `「${mainConcept.name}」掌握度 ${result.oldValue.toFixed(2)} → ${result.newValue.toFixed(2)}`;
    }
  }

  // 7. 组装提示词（人格：Grok persona 启发，settings kv 读取；苏格拉底续轮换用引导续轮段）
  const system = buildExplainSystemPrompt({
    depth,
    profileHit,
    usedEntries,
    missingPrereqs,
    evidence,
    feedback: opts.regen?.feedback,
    persona,
    socraticCont: Boolean(socraticContinue),
  });
  const finalUserText = opts.userText ?? "请重新回答我上面的问题。";
  const llmMessages = buildLlmMessages(system, opts.history, finalUserText, compressed ? HISTORY_LIMIT_COMPRESSED : HISTORY_LIMIT);

  // 8. 创建/接续 assistant 消息行
  let assistantMessageId: string;
  let slotIndex: number;
  if (opts.regen) {
    slotIndex = opts.regen.slotIndex;
    const revision = messagesRepo.nextRevision(conversationId, slotIndex);
    assistantMessageId = messagesRepo.insertMessage({
      conversationId,
      userId,
      role: "assistant",
      content: "",
      slotIndex,
      revision,
      parentMessageId: opts.regen.assistantMessageId,
      status: "streaming",
    });
  } else {
    slotIndex = messagesRepo.nextSlot(conversationId);
    assistantMessageId = messagesRepo.insertMessage({
      conversationId,
      userId,
      role: "assistant",
      content: "",
      slotIndex,
      revision: 1,
      status: "streaming",
    });
  }

  const meta: MessageMeta = {
    depth,
    concept_name: mainConcept?.name ?? null,
    domain: mainConcept?.domain ?? null,
    profile_hit: profileHit,
    used_entries: usedEntries,
    missing_prereqs: missingPrereqs,
    evidence,
    feedback: opts.regen?.feedback,
    prompt_version: EXPLAIN_PROMPT_VERSION,
    persona,
  };

  yield {
    type: "meta",
    assistant_message_id: assistantMessageId,
    slot_index: slotIndex,
    depth,
    concept_name: meta.concept_name,
    domain: meta.domain,
    profile_hit: profileHit,
    used_entries: usedEntries,
    missing_prereqs: missingPrereqs,
    evidence,
    feedback: opts.regen?.feedback,
    persona,
  };
  if (feedbackSignalNote) yield { type: "notice", message: feedbackSignalNote };
  if (extractionFailed) yield { type: "notice", message: "概念识别暂时不可用，本次按默认深度讲解" };
  if (compressed) {
    yield {
      type: "notice",
      message: `会话已达 Token 预算 80%（${budget.used.toLocaleString()}/${budget.budget.toLocaleString()}），已压缩上下文：画像注入缩减至 Top-3、舍弃证据原文、历史截短`,
    };
  }

  // 9. 流式生成，降级顺序（FR-09 ④）：重试 1 次（退避）→ 切换备用模型 → 明确失败（E-01/E-02）
  let full = "";
  let tokenIn = 0;
  let tokenOut = 0;
  let latencyMs = 0;
  let usedModel = env.model;

  const attempt = async function* (model: string): AsyncGenerator<{ text?: string; done?: { tin: number; tout: number; ms: number } }> {
    for await (const chunk of chatStream(env, llmMessages, { model, signal: opts.abortSignal })) {
      if (chunk.type === "delta") yield { text: chunk.text };
      else yield { done: { tin: chunk.tokenIn, tout: chunk.tokenOut, ms: chunk.latencyMs } };
    }
  };

  const consume = async function* (model: string): AsyncGenerator<{ text?: string; done?: { tin: number; tout: number; ms: number } } | "failed"> {
    try {
      for await (const c of attempt(model)) {
        if (opts.abortSignal?.aborted) return;
        yield c;
      }
    } catch {
      yield "failed";
    }
  };

  let succeeded = false;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  outer: {
    // 主模型 → 失败重试 1 次（指数退避）
    for (let i = 0; i < 2; i++) {
      let failed = false;
      for await (const c of consume(env.model)) {
        if (c === "failed") {
          failed = true;
          break;
        }
        if (c.text) {
          full += c.text;
          yield { type: "delta", text: c.text };
        } else if (c.done) {
          tokenIn = c.done.tin;
          tokenOut = c.done.tout;
          latencyMs = c.done.ms;
        }
      }
      if (opts.abortSignal?.aborted) break outer;
      if (!failed) {
        succeeded = full.length > 0 || tokenOut > 0;
        break outer;
      }
      if (i === 0 && full.length === 0) {
        yield { type: "notice", message: "模型响应异常，正在重试…" };
        await sleep(1200);
      }
    }

    // 重试仍失败 → 备用模型（AC-09-2）
    const backup = backupModel();
    if (!backup) break outer;
    yield { type: "notice", message: "主模型暂时不可用，已切换备用模型" };
    usedModel = backup;
    full = "";
    for await (const c of consume(backup)) {
      if (c === "failed") break;
      if (c.text) {
        full += c.text;
        yield { type: "delta", text: c.text };
      } else if (c.done) {
        tokenIn = c.done.tin;
        tokenOut = c.done.tout;
        latencyMs = c.done.ms;
      }
    }
    succeeded = full.length > 0;
  }

  if (!succeeded) {
    const aborted = opts.abortSignal?.aborted ?? false;
    const message = aborted
      ? "生成已中断，已生成内容已保留"
      : full.length > 0
        ? "生成未完成，已保留部分内容，可点击重试"
        : `模型调用失败：请检查网络与模型服务状态，稍后重试`;
    messagesRepo.updateMessageContent(assistantMessageId, full, "incomplete", meta);
    yield { type: "error", code: aborted ? "aborted" : "model_error", message, assistant_message_id: assistantMessageId };
    insertAiLog({ userId, scene: "explain", model: usedModel, promptVersion: EXPLAIN_PROMPT_VERSION, tokenIn, tokenOut, latencyMs, status: "error" });
    return;
  }

  // 10. 落库完成态；苏格拉底流程状态按复盘标记判定（有标记 → done，流程回归正常模式）
  meta.model = usedModel;
  if (persona === "socratic") {
    meta.socratic_state = full.includes(SOCRATIC_RECAP_MARKER) ? "done" : "guiding";
  }
  if (hasDiagramContent(full)) meta.has_diagram = true;
  messagesRepo.updateMessageContent(assistantMessageId, full, "normal", meta);
  conversationsRepo.touchConversation(conversationId, tokenIn + tokenOut);
  insertAiLog({ userId, scene: "explain", model: usedModel, promptVersion: EXPLAIN_PROMPT_VERSION, tokenIn, tokenOut, latencyMs });

  // 11. 画像信号回流（FR-08 ①）——仅新提问时；反馈信号已在第 6 步处理
  const profileUpdates: string[] = [];
  if (opts.userMessageId && opts.userText) {
    const evidenceRef: EvidenceRef = {
      type: "message",
      id: opts.userMessageId,
      conversation_id: conversationId,
      slot: opts.userSlot ?? 0,
    };
    const allConcepts = [
      ...(mainConcept ? [{ ...mainConcept, isMain: true }] : []),
      ...relatedConcepts.map((c) => ({ ...c, isMain: false })),
    ];
    for (const c of allConcepts) {
      try {
        const r = ensureEntryFromAsk({
          userId,
          name: c.name,
          domain: c.domain,
          isMain: c.isMain,
          evidence: evidenceRef,
        });
        profileUpdates.push(r.created ? `新增画像：「${c.name}」（0.30）` : `接触记录：「${c.name}」`);
      } catch {
        /* 单个概念失败不阻断讲解 */
      }
    }
  }

  yield {
    type: "done",
    assistant_message_id: assistantMessageId,
    token_in: tokenIn,
    token_out: tokenOut,
    latency_ms: latencyMs,
    model: usedModel,
    profile_updates: profileUpdates,
  };
}
