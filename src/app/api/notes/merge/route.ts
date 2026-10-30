import { NextRequest } from "next/server";
import { getDefaultUserId } from "@/lib/db";
import { createNote, getNote } from "@/lib/db/repo/notes";
import { chatComplete, llmEnv } from "@/lib/llm/client";
import { buildMultiMergeMessages, MULTI_MERGE_PROMPT_VERSION } from "@/lib/llm/prompts/multi-merge";
import { prefixSourceAnchors, keepKnownTokens } from "@/lib/notes/anchors";
import { insertAiLog } from "@/lib/db/repo/ailogs";

/** 多篇合并（B-2）：勾选 2–6 篇笔记 → 合成一份主题总纲（新笔记，原笔记不动）。 */
export async function POST(req: NextRequest) {
  const userId = getDefaultUserId();
  const env = llmEnv();
  if (!env) return Response.json({ error: "未配置模型服务" }, { status: 503 });

  const body = (await req.json()) as { note_ids?: string[] };
  const ids = [...new Set(body.note_ids ?? [])];
  if (ids.length < 2 || ids.length > 6) {
    return Response.json({ error: "请选择 2–6 篇笔记进行合并" }, { status: 400 });
  }
  const sources = ids.map((id) => getNote(id, userId));
  if (sources.some((s) => !s)) return Response.json({ error: "有笔记不存在" }, { status: 404 });

  const { contents, anchors, byToken } = prefixSourceAnchors(
    sources.map((s) => ({ id: s!.id, content: s!.content, anchors: s!.anchors })),
  );
  const titles = sources.map((s) => s!.title);

  const started = Date.now();
  let content: string;
  try {
    const r = await chatComplete(env, buildMultiMergeMessages(titles.map((t, i) => ({ title: t, content: contents[i] }))), {
      timeoutMs: 150_000,
    });
    content = r.content.trim().replace(/^```\w*\n?|```\s*$/g, "").trim();
    insertAiLog({
      userId,
      scene: "note",
      model: env.model,
      promptVersion: MULTI_MERGE_PROMPT_VERSION,
      tokenIn: r.tokenIn,
      tokenOut: r.tokenOut,
      latencyMs: Date.now() - started,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    insertAiLog({ userId, scene: "note", model: env.model, promptVersion: MULTI_MERGE_PROMPT_VERSION, tokenIn: 0, tokenOut: 0, latencyMs: Date.now() - started, status: "error" });
    return Response.json({ error: `合并失败：${message}` }, { status: 502 });
  }

  // 只保留映射内 token，其余（LLM 幻觉标记）剔除
  content = keepKnownTokens(content, new Set(byToken.keys()));
  const titleMatch = content.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : `${titles[0]} 等的主题总纲`;

  const note = createNote({
    userId,
    conversationId: null,
    sourceTitle: `合并自 ${sources.length} 篇笔记`,
    title,
    content,
    anchors,
  });
  return Response.json({ note });
}
