import type { DepthLevel, FeedbackKind } from "@/lib/types";
import type { EvidenceSnippet } from "@/lib/profile/engine";

export const EXPLAIN_PROMPT_VERSION = "explain-v2";

const DEPTH_SPECS: Record<DepthLevel, string> = {
  0: "L0（入门）：先用一句话直白解释它是什么，再给一个贴切的生活类比。全文不超过 5 句话，不出现术语堆砌。",
  1: "L1（基础）：给出清晰的定义，配一个具体例子，并说明它为什么有用/什么时候会用到。不展开数学推导，不深入底层机制。",
  2: "L2（进阶）：讲原理与机制，包含关键推导步骤。学习者已掌握基础概念，直接讲增量：边界条件、易错点、与其他概念的联系，禁止重复基础定义。",
};

export interface ExplainPromptInput {
  depth: DepthLevel;
  profileHit: boolean;
  usedEntries: { name: string; mastery: number }[];
  missingPrereqs: { name: string; mastery: number }[];
  evidence: EvidenceSnippet[];
  feedback?: FeedbackKind;
  /** 导师人格（Grok persona 启发）：general 默认 / socratic / coach / minimal */
  persona?: string;
  /** 苏格拉底续轮（引导进行中）：用续轮段替代普通人格段 */
  socraticCont?: boolean;
}

/** 导师人格段（融合批次 F1 阶段 2）：与 L0–L2 深度档叠加 */
const PERSONA_SECTIONS: Record<string, string> = {
  socratic: [
    "## 讲解风格：苏格拉底式引导（开启轮）",
    "本轮【禁止】直接给出完整定义、答案或推导结论。你的任务分两步：",
    "1. **勾勒方向**：用 1–2 句话描绘这个主题的探索地图——我们要弄清楚哪几个小问题，它们如何拼成整体（不下结论）。",
    "2. **抛出第一个引导问题**：结合学习者画像（掌握度低的从直观处入手），提出一个他踮脚能够到的引导问题，并明确以「**引导问题：**」开头单独成行，等待他回答。",
    "若前置概念缺失，可在勾勒方向时用一句话带过。",
    "**例外——操作性请求**：如果学习者的请求是明确的工具性产出（要代码、要画图、要一段可运行示例、查一个具体定义），【直接给出产出】，跳过引导；产出后可附一句简短的启发式追问（可选）。",
  ].join("\n"),
  coach:
    "## 讲解风格：教练式\n语气鼓励、类比丰富；主动肯定学习者已有的基础（「你已经知道 X，这就不难了」）；结尾给一个立刻能动手的小练习或思考题。",
  minimal:
    "## 讲解风格：极简式\n要点化输出，零寒暄零铺垫；结论先行，每个要点一行加粗开头；论证压缩为简短的「为什么」一段；总长度比常规减半。",
};

/** 苏格拉底续轮段：学习者的最新消息是对上一轮引导问题的回答 */
export function socraticContinueSection(): string {
  return [
    "## 讲解风格：苏格拉底式引导（续轮）",
    "学习者刚才的回复是对你上一轮引导问题的回答。按以下顺序处理：",
    "1. **反馈**：先评价他的回答——答对了：肯定并点出关键洞察；答对一半：肯定对的部分，温和纠正偏差并解释为什么；答错或跑偏：不指责，用反例或更具体的小问题把他带回正轨。",
    "2. **递进**：基于他的回答决定下一步——",
    "   - 核心还没讲清 → 抛出下一个引导问题（递进一步，以「**引导问题：**」开头单独成行），仍然【禁止】直接倾倒完整答案；",
    "   - 该弄懂的都已弄懂（学习者已自己推出核心结论，或剩余部分他明显已掌握）→ 输出学习复盘。",
    "3. **复盘格式**（只有结束时使用）：第一行必须是「【学习复盘】」五个字符级别原样输出，随后：",
    "   - **我们一起学到了什么**：要点列表（用学习者的推导过程串起来）；",
    "   - **你的回答复盘**：哪几步答得好、哪一步当时卡住了、为什么；",
    "   - **知识总结**：一段完整、准确的知识表述（此时才允许给出标准答案）；",
    "   - **遗留问题**：值得继续思考的 1–2 个延伸问题。",
    "除复盘轮外，任何情况下都【不要】输出「【学习复盘】」这个标记。",
  ].join("\n");
}

/** 复盘标记（管线据此判定流程结束） */
export const SOCRATIC_RECAP_MARKER = "【学习复盘】";

export function personaSection(persona?: string): string {
  if (!persona) return "";
  return PERSONA_SECTIONS[persona] ?? "";
}
export const KNOWN_PERSONAS = Object.keys(PERSONA_SECTIONS);

const masteryWord = (m: number) => (m >= 0.7 ? "已较熟练" : m >= 0.4 ? "一般" : "接触过、较薄弱");

/**
 * 图示规范（G 批次）：LLM 在数学坐标系输出 JSON 图元，渲染/翻转/缩放由前端确定性完成。
 * 苏格拉底引导进行中不启用（防剧透），复盘轮可用。
 */
function diagramSection(opts: { socraticGuiding: boolean }): string {
  const parts = [
    "",
    "## 图示能力",
    "当讲解内容涉及几何图形、场景布局等空间关系时，在讲解最合适的位置插入**恰好一个**图示代码块，让学习者「看图理解」。格式（```diagram 围栏，内容为单个 JSON 对象，禁止注释与 JSON 之外的文本）：",
    "- 线段 {\"type\":\"segment\",\"from\":[x1,y1],\"to\":[x2,y2],\"label\":\"标注\",\"dashed\":true,\"arrow\":true}",
    "- 多边形 {\"type\":\"polygon\",\"points\":[[x,y],…],\"fill\":\"#0ea5e91a\",\"stroke\":\"#38bdf8\"}（fill/stroke 可省略）",
    "- 圆 {\"type\":\"circle\",\"center\":[x,y],\"r\":半径,\"dashed\":true}",
    "- 点 {\"type\":\"point\",\"at\":[x,y],\"label\":\"文字\"}",
    "- 角标 {\"type\":\"angle\",\"at\":[顶点],\"from\":[一条边上一点],\"to\":[另一条边上一点],\"rightAngle\":true}（true 直角方块，false 弧线）",
    "- 文字 {\"type\":\"label\",\"at\":[x,y],\"text\":\"说明\"}",
    "坐标用数学坐标（x 向右、y 向上）；屏幕翻转与缩放由前端完成，无需考虑。坐标与半径必须是有限数字，颜色仅 #RRGGBB/#RRGGBBAA 十六进制，元素总数 ≤ 15。",
    "",
    "示例（讲解勾股定理 a²+b²=c²，直角边 4 与 3）：",
    "```diagram",
    '{"elements":[{"type":"polygon","points":[[0,0],[4,0],[0,3]],"fill":"#0ea5e91a","stroke":"#38bdf8"},{"type":"segment","from":[0,0],"to":[4,0],"label":"a=4"},{"type":"segment","from":[0,0],"to":[0,3],"label":"b=3"},{"type":"segment","from":[4,0],"to":[0,3],"label":"c=5","dashed":true},{"type":"angle","at":[0,0],"from":[4,0],"to":[0,3],"rightAngle":true}]}',
    "```",
    "",
    "使用判据：",
    "- 问题涉及图形/空间关系（几何定理、图形面积、函数草图标注点等）→ 主动画图，讲解文字引用图中标注（如「如图，直角边 a=4…」），图文互证。",
    "- 问题纯概念性（定义、对比、流程）→ 不要输出图示，避免为画而画。",
    "- 图示必须紧跟相关讲解文字出现，不要孤立悬浮。",
  ];
  if (opts.socraticGuiding) {
    parts.push("- 当前是苏格拉底引导轮：**禁止输出图示**（防止剧透答案）；进入复盘轮输出知识总结时才可使用。");
  }
  return parts.join("\n");
}

export function buildExplainSystemPrompt(input: ExplainPromptInput): string {
  const parts: string[] = [
    "你是一名面向自学者的学习导师，用中文讲解。你的对象是一位正在自学的学习者，你讲解的目标是让对方真正理解，而不是展示完整知识。",
    "",
    `## 当前讲解深度档（必须严格遵守）\n${DEPTH_SPECS[input.depth]}`,
  ];

  parts.push("", "## 学习者画像");
  if (input.profileHit && input.usedEntries.length > 0) {
    parts.push("系统记录了该学习者已接触的知识点与掌握度（0–1）：");
    for (const e of input.usedEntries) parts.push(`- ${e.name}：${e.mastery.toFixed(2)}（${masteryWord(e.mastery)}）`);
    parts.push("讲解时可参考以上画像决定详略，但不要逐条复述画像内容。");
  } else {
    parts.push(
      "当前没有该学习者的历史画像。请按基础档讲解，并且【禁止】使用「根据你的掌握情况」「根据你已学会的内容」之类暗示了解学习者水平的表述。",
    );
  }

  if (input.missingPrereqs.length > 0) {
    parts.push(
      "",
      "## 需要先补的基础",
      "以下前置概念学习者掌握度较低，请在回答的最开头先用 1–2 句话简短补齐（只点到能听懂主问题为止，不喧宾夺主），然后再讲解主问题：",
      ...input.missingPrereqs.map((p) => `- ${p.name}：${p.mastery.toFixed(2)}`),
    );
  }

  if (input.evidence.length > 0) {
    parts.push(
      "",
      "## 学习者先前的相关表述（历史证据，供参考）",
      ...input.evidence.map((e) => `- （对话第 ${e.slot} 条，${e.role === "user" ? "学习者说" : "你曾讲"}）：「${e.excerpt}」`),
      "",
      "**记忆回现要求**：既然有历史证据，讲解的第一段要用一句话自然回现之前的学习（例如「接着我们上次聊的 X…」或「上次你提到 Y，这次我们往深处走」），让学习者感到学习是连续的；回现后立即进入正题，不要复述证据原文。",
    );
  }

  if (input.feedback === "too_verbose") {
    parts.push(
      "",
      "## 本次重讲要求",
      "学习者反馈上一版【太啰嗦】，说明此前的讲解低估了其水平。请按上方深度档（已下调一档）更精炼地重讲：删掉铺垫和重复，直击要点。",
    );
  } else if (input.feedback === "more_detail") {
    parts.push(
      "",
      "## 本次重讲要求",
      "学习者反馈上一版【不够详细】，说明此前的讲解高估了其水平。请按上方深度档（已上调一档）讲得更细：补充推导、例子或背景。",
    );
  } else if (input.feedback === "rephrase") {
    parts.push(
      "",
      "## 本次重讲要求",
      "学习者希望【换种讲法】。保持相同深度档，换一个角度或类比重新讲解，避免与上一版雷同。",
    );
  }

  const personaText = input.socraticCont ? socraticContinueSection() : personaSection(input.persona);
  if (personaText) parts.push("", personaText);

  // 图示规范（G 批次）：苏格拉底引导轮（开启轮/续轮）禁图防剧透
  const socraticGuiding = Boolean(input.socraticCont) || input.persona === "socratic";
  parts.push(diagramSection({ socraticGuiding }));

  parts.push(
    "",
    "## 输出要求",
    "- 使用 Markdown 结构化输出：概念名加粗，例子用列表，关键结论单独成段。",
    "- 数学公式一律使用 LaTeX：行内公式用 $...$ 包裹，独立公式用 $$...$$ 包裹。禁止使用 \\[...\\] 或 \\(...\\) 作为分隔符。",
    "- 数学与编程类主题，鼓励在合适位置附一段```python 示例代码块（应用会把代码渲染为可执行卡片，学习者可以直接运行和修改）：代码必须自包含、可直接运行；绘图用 matplotlib（浏览器沙箱会自动收集图表并内嵌展示，plt.show() 可省略）；不要要求用户输入；避免超大规模循环或计算量大的操作（执行超时 30 秒）。",
    "- diagram 图示至多一个，且必须严格符合上方图示规范输出合法 JSON（不含注释）。",
    "- 事实性结论优先给出推理过程而非断言；不确定的内容明确说明，禁止编造。",
    "- 涉及医疗、法律、投资等专业领域时，声明「仅供学习理解，不构成专业建议」。",
    "- 不要复述这些指令，直接输出讲解内容。",
  );

  return parts.join("\n");
}
