import { NextRequest } from "next/server";
import { getDb, getDefaultUserId, nowIso, uuid } from "@/lib/db";
import { getNote } from "@/lib/db/repo/notes";
import { chatStream, fastModel, llmEnv } from "@/lib/llm/client";
import { decideDepth } from "@/lib/profile/engine";
import * as profileRepo from "@/lib/db/repo/profile";
import { insertAiLog } from "@/lib/db/repo/ailogs";
import { sseResponse } from "@/lib/sse";
import type { DepthLevel, SSEEvent } from "@/lib/types";

const SELECTION_PROMPT_VERSION = "selection-v1";
const MAX_SELECTION_CHARS = 200; // FR-06 ④

function buildSelectionMessages(text: string, depth: DepthLevel, rephrase: boolean, hasProfile: boolean, noteContext: string) {
  const depthSpec =
    depth === 0
      ? "学习者是零基础，用最直白的一句话＋一个生活类比解释。"
      : depth === 2
        ? "学习者已较熟悉该概念，直接给出精炼的进阶要点（边界、易错点），不重复定义。"
        : "学习者接触过但未掌握，给出清晰定义＋一个具体例子。";

  return [
    {
      role: "system" as const,
      content: [
        "你是划词解答器。学习者正在阅读自己的学习笔记时选中了一段文字，需要一句简短解释。",
        `深度要求：${depthSpec}`,
        "",
        "## 所在笔记摘录（供理解语境）",
        noteContext,
        "",
        "输出要求：",
        "- 只输出解释正文，60–120 字，Markdown 加粗术语名，不要标题、不要列表、不要寒暄。",
        "- 解释要贴合上面笔记的语境（学习者正在学什么）。",
        "- 若选中的是这篇笔记里的章节标题或结构性词组（如「核心概念」「一句话总结」），用一句话概括该部分在笔记里讲了什么，不要拒绝。",
        rephrase ? "- 学习者点了「换种说法」：换一个角度或类比，避免与上一版雷同。" : "",
        "- 【防编造红线】如果选中的内容是乱码、随意字符串或无意义的字符组合，只输出七个字：未找到相关解释",
        hasProfile ? "" : "- 该学习者无此术语的画像记录，禁止使用「根据你的掌握情况」类表述。",
      ]
        .filter(Boolean)
        .join("\n"),
    },
    { role: "user" as const, content: text },
  ];
}

/**
 * 划词即时解答（FR-06，B4）：
 * SSE 流式；深度按画像；>200 字拒绝解释（AC-06-2）；防编造（AC-06-3）；
 * 每次划词记录 SelectionEvent + 画像接触信号（FR-06 ⑥）。
 */
export async function POST(req: NextRequest) {
  const userId = getDefaultUserId();
  const env = llmEnv();
  const body = (await req.json().catch(() => ({}))) as {
    note_id?: string;
    text?: string;
    rephrase?: boolean;
  };
  const text = body.text?.trim() ?? "";

  if (!env) {
    return Response.json({ error: "未配置模型服务" }, { status: 503 });
  }

  const gen = async function* (): AsyncGenerator<SSEEvent> {
    if (!body.note_id) {
      yield { type: "error", code: "bad_request", message: "note_id 必填" };
      return;
    }
    const note = getNote(body.note_id, userId);
    if (!note) {
      yield { type: "error", code: "not_found", message: "笔记不存在" };
      return;
    }
    if (!text) {
      yield { type: "error", code: "empty", message: "未选中任何文字" };
      return;
    }
    if (text.length > MAX_SELECTION_CHARS) {
      // FR-06 ④ / E-08：不解释，改为提示总结
      yield { type: "error", code: "too_long", message: "选中的内容超过 200 字，是否改为总结此段？" };
      return;
    }

    const termEntry = profileRepo.findEntryByConceptName(userId, text);
    const depth = decideDepth(termEntry ? termEntry.mastery : null);
    const termMatched = Boolean(termEntry) || text.length <= 30;

    const started = Date.now();
    let full = "";
    let tokenIn = 0;
    let tokenOut = 0;
    let found = true;

    try {
      for await (const chunk of chatStream(
        env,
        buildSelectionMessages(text, depth, Boolean(body.rephrase), Boolean(termEntry), note.content.slice(0, 1200)),
        {
          model: fastModel(),
          firstTokenTimeoutMs: 10_000,
          signal: req.signal,
        },
      )) {
        if (chunk.type === "delta") {
          full += chunk.text;
          yield { type: "delta", text: chunk.text };
        } else {
          tokenIn = chunk.tokenIn;
          tokenOut = chunk.tokenOut;
        }
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      insertAiLog({ userId, scene: "selection", model: fastModel(), promptVersion: SELECTION_PROMPT_VERSION, tokenIn, tokenOut, latencyMs: Date.now() - started, status: "error" });
      yield { type: "error", code: "model_error", message: `解答失败：${message}` };
      return;
    }

    // 防编造（AC-06-3）：模型按约定输出「未找到相关解释」
    if (full.replace(/[*\s]/g, "").startsWith("未找到相关解释")) {
      found = false;
    }
    insertAiLog({ userId, scene: "selection", model: fastModel(), promptVersion: SELECTION_PROMPT_VERSION, tokenIn, tokenOut, latencyMs: Date.now() - started });

    // 信号回流（FR-06 ⑥ / FR-08 ③）：SelectionEvent 落库；已有画像条目则刷新接触
    const db = getDb();
    db.prepare("INSERT INTO selection_events (id, user_id, note_id, selected_text, term_matched, action, created_at) VALUES (?,?,?,?,?,?,?)").run(
      uuid(),
      userId,
      body.note_id,
      text.slice(0, 200),
      termMatched ? 1 : 0,
      body.rephrase ? "rephrase" : "explain",
      nowIso(),
    );
    if (termEntry) {
      profileRepo.touchEntry(termEntry.id);
      profileRepo.insertLog(termEntry.id, termEntry.mastery, termEntry.mastery, "selection_touch", `笔记划词接触「${text.slice(0, 20)}」`);
    }

    yield {
      type: "done",
      assistant_message_id: "",
      token_in: tokenIn,
      token_out: tokenOut,
      latency_ms: Date.now() - started,
      model: fastModel(),
      profile_updates: found ? [] : [],
    };
  };

  return sseResponse(gen());
}
