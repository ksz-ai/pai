export const EXTRACT_PROMPT_VERSION = "extract-v2";

export interface ExtractResult {
  concepts: { name: string; domain?: string; is_main: boolean }[];
}

export function buildExtractMessages(question: string, knownConcepts: string[]) {
  const known =
    knownConcepts.length > 0
      ? `已有知识点列表（复用时名称写法保持完全一致）：\n${knownConcepts.map((c) => `- ${c}`).join("\n")}`
      : "已有知识点列表：暂无";

  return [
    {
      role: "system" as const,
      content: [
        "你是学习行为分析器。根据学习者提出的问题，识别其中涉及的知识点。",
        "规则：",
        "1. **is_main 概念不可省略**：问题的核心主题（提问想学会的那个定理/概念/技术）必须作为 is_main=true 的概念——它不在已有列表中就新增，在列表中也必须标记 is_main=true。「复用已有列表」只影响名称写法，绝不能让问题的核心主题缺席。",
        "2. 相关/前置概念 is_main=false；绘制、举例类请求中提到的核心定理优先级最高。",
        "3. domain 填学科名（如：线性代数、概率论、操作系统、计算机网络、机器学习、平面几何）。is_main 概念必须给出 domain。",
        "4. 概念总数不超过 4 个；纯闲聊或与学习无关的问题返回 {\"concepts\":[]}。",
        "5. 只输出 JSON，不要任何解释。格式：{\"concepts\":[{\"name\":\"...\",\"domain\":\"...\",\"is_main\":true}]}",
      ].join("\n"),
    },
    {
      role: "user" as const,
      content: `${known}\n\n学习者的问题：${question}`,
    },
  ];
}
