import { NextRequest, NextResponse } from "next/server";
import { getLlmSettings } from "@/lib/db/repo/settings";
import { chatComplete, llmEnv, type LLMEnv } from "@/lib/llm/client";

/**
 * 测试连接：用表单当前值（未保存也能测），缺省用已保存/env 生效配置。
 * 发送一个 max_tokens=1 的最小请求，返回明确的成功/失败信息。
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    base_url?: string;
    api_key?: string;
    model?: string;
  };

  let env: LLMEnv | null;
  if (body.base_url?.trim() && body.model?.trim()) {
    // 表单值测试：Key 用表单输入，若为空则借用已保存的（用户只想换模型时）
    const saved = getLlmSettings();
    const apiKey = body.api_key?.trim() || saved.api_key || llmEnv()?.apiKey || "";
    env = { baseUrl: body.base_url.trim().replace(/\/+$/, ""), apiKey, model: body.model.trim() };
  } else {
    env = llmEnv();
  }

  if (!env || !env.apiKey) {
    return NextResponse.json({ ok: false, message: "请先填写 API Key" });
  }

  try {
    const r = await chatComplete(env, [{ role: "user", content: "回复：ok" }], {
      model: env.model,
      maxTokens: 8,
      timeoutMs: 20_000,
    });
    return NextResponse.json({
      ok: true,
      message: `连接成功（${env.model}，${r.latencyMs}ms）`,
      latency_ms: r.latencyMs,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const hint = message.includes("401")
      ? "——Key 无效或已过期，请检查"
      : message.includes("404")
        ? "——服务地址或模型名可能有误"
        : message.includes("429")
          ? "——额度/限流问题，Key 可能没余额"
          : message.includes("fetch failed") || message.includes("ENOTFOUND") || message.includes("timeout")
            ? "——网络不通或服务地址错误"
            : "";
    return NextResponse.json({ ok: false, message: `${message.slice(0, 160)}${hint}` });
  }
}
