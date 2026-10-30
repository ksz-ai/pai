export const EXTRACT_PROMPT_VERSION = "extract-v1";

export interface ExtractResult {
  concepts: { name: string; domain?: string; is_main: boolean }[];
}

export function buildExtractMessages(question: string, knownConcepts: string[]) {
  const known =
    knownConcepts.length > 0
      ? `已有知识点列表（优先复用其中的名称，写法保持完全一致）：\n${knownConcepts.map((c) => `- ${c}`).join("\n")}`
      : "已有知识点列表：暂无";

  return [
    {
      role: "system" as const,
      content: [
        "你是学习行为分析器。根据学习者提出的问题，识别其中涉及的知识点。",
        "规则：",
        "1. 优先复用「已有知识点列表」中的名称（写法完全一致）；列表中没有的新概念，使用最通用的标准中文名称。",
        "2. is_main=true 标记问题的核心概念（最多 1 个）；其余相关/前置概念 is_main=false。",
        "3. domain 填学科名（如：线性代数、概率论、操作系统、计算机网络、机器学习、数据结构）。只对核心概念给出 domain。",
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
