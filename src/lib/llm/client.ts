/**
 * LLM 抽象层：统一走 OpenAI 兼容协议（PRD 13.1：必须支持多供应商切换）。
 * 仅服务端使用，API Key 不出后端（PRD §11）。
 *
 * 配置来源（PRD E-13：设置页配置后立即生效，无需重启）：
 * 1. 设置页保存到 SQLite 的配置（优先）
 * 2. 环境变量 .env.local（兜底，适合开发者预配置）
 */

import { getLlmSettings } from "@/lib/db/repo/settings";

export interface LLMEnv {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface ChatMsg {
  role: "system" | "user" | "assistant";
  content: string;
}

export function llmEnv(): LLMEnv | null {
  // 1. 设置页配置（DB）
  try {
    const s = getLlmSettings();
    if (s.base_url && s.api_key && s.model) {
      return { baseUrl: s.base_url.replace(/\/+$/, ""), apiKey: s.api_key, model: s.model };
    }
  } catch {
    /* DB 不可用（如构建期）时退回环境变量 */
  }
  // 2. 环境变量兜底
  const baseUrl = process.env.LLM_BASE_URL?.trim();
  const apiKey = process.env.LLM_API_KEY?.trim();
  const model = process.env.LLM_MODEL?.trim();
  if (!baseUrl || !apiKey || !model) return null;
  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey, model };
}

export function fastModel(): string {
  const s = getLlmSettings();
  if (s.fast_model) return s.fast_model;
  return process.env.LLM_MODEL_FAST?.trim() || (llmEnv()?.model ?? "");
}

export function backupModel(): string | null {
  const s = getLlmSettings();
  if (s.backup_model) return s.backup_model;
  return process.env.LLM_MODEL_BACKUP?.trim() || null;
}

interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
}

/** 非流式补全（概念抽取 / 笔记生成 / 连接测试） */
export async function chatComplete(
  env: LLMEnv,
  messages: ChatMsg[],
  opts?: { model?: string; json?: boolean; timeoutMs?: number; maxTokens?: number },
): Promise<{ content: string; tokenIn: number; tokenOut: number; latencyMs: number }> {
  const model = opts?.model ?? env.model;
  const started = Date.now();
  const res = await fetch(`${env.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.apiKey}` },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      ...(opts?.maxTokens ? { max_tokens: opts.maxTokens } : {}),
      ...(opts?.json ? { response_format: { type: "json_object" } } : {}),
    }),
    signal: AbortSignal.timeout(opts?.timeoutMs ?? 120_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`LLM ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    choices: { message: { content: string } }[];
    usage?: Usage;
  };
  return {
    content: data.choices?.[0]?.message?.content ?? "",
    tokenIn: data.usage?.prompt_tokens ?? 0,
    tokenOut: data.usage?.completion_tokens ?? 0,
    latencyMs: Date.now() - started,
  };
}

export type StreamChunk =
  | { type: "delta"; text: string }
  | { type: "done"; tokenIn: number; tokenOut: number; latencyMs: number };

export class TimeoutError extends Error {}

/**
 * 流式补全（讲解）。仅对「首个 token」设超时（E-01）；
 * 首 token 到达后撤掉定时器，长回答不会被总时长误杀。
 */
export async function* chatStream(
  env: LLMEnv,
  messages: ChatMsg[],
  opts?: { model?: string; firstTokenTimeoutMs?: number; signal?: AbortSignal },
): AsyncGenerator<StreamChunk> {
  const model = opts?.model ?? env.model;
  const started = Date.now();
  const timeoutMs = opts?.firstTokenTimeoutMs ?? 30_000;

  const abort = new AbortController();
  let timedOut = false;
  const onOuterAbort = () => abort.abort();
  opts?.signal?.addEventListener("abort", onOuterAbort);
  const firstTokenTimer: ReturnType<typeof setTimeout> = setTimeout(() => {
    timedOut = true;
    abort.abort();
  }, timeoutMs);

  const cleanup = () => {
    clearTimeout(firstTokenTimer);
    opts?.signal?.removeEventListener("abort", onOuterAbort);
  };

  try {
    const res = await fetch(`${env.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.apiKey}` },
      body: JSON.stringify({ model, messages, stream: true, stream_options: { include_usage: true } }),
      signal: abort.signal,
    }).catch((e: unknown) => {
      if (timedOut) throw new TimeoutError(`首 token 超时（${timeoutMs / 1000}s）`);
      throw e;
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`LLM ${res.status}: ${text.slice(0, 200)}`);
    }

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let tokenIn = 0;
    let tokenOut = 0;
    let gotFirst = false;

    try {
      while (true) {
        const { done, value } = await reader.read().catch((e: unknown) => {
          if (timedOut) throw new TimeoutError(`首 token 超时（${timeoutMs / 1000}s）`);
          throw e;
        });
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n");
        buffer = parts.pop() ?? "";
        for (const line of parts) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === "[DONE]") continue;
          let json: {
            choices?: { delta?: { content?: string } }[];
            usage?: Usage;
          };
          try {
            json = JSON.parse(payload);
          } catch {
            continue;
          }
          if (json.usage) {
            tokenIn = json.usage.prompt_tokens ?? tokenIn;
            tokenOut = json.usage.completion_tokens ?? tokenOut;
          }
          const text = json.choices?.[0]?.delta?.content;
          if (text) {
            if (!gotFirst) {
              gotFirst = true;
              clearTimeout(firstTokenTimer); // 首 token 已到，撤掉超时
            }
            yield { type: "delta", text };
          }
        }
      }
      yield { type: "done", tokenIn, tokenOut, latencyMs: Date.now() - started };
    } finally {
      reader.releaseLock?.();
    }
  } finally {
    cleanup();
  }
}

/** 宽松 JSON 解析：剥离代码围栏、截取首个对象 */
export function parseJsonLoose<T>(text: string): T {
  let t = text.trim();
  t = t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) t = t.slice(start, end + 1);
  return JSON.parse(t) as T;
}
