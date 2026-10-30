export const APPEND_MERGE_PROMPT_VERSION = "append-merge-v1";

export function buildAppendMergeMessages(existingNote: string, sourceText: string) {
  return [
    {
      role: "system" as const,
      content: [
        "你是笔记增量整理器。学习者与导师就同一主题进行了新一轮对话，要把新对话里有价值的内容融入已有笔记。",
        "",
        "## 现有笔记全文",
        "（其中 [[a数字]] 是指向其他对话原文的溯源标记，是既有内容的一部分，【原样保留，不要改动、不要新增同格式标记】）",
        "",
        existingNote,
        "",
        "## 新对话片段",
        "（[mN] 为新对话的消息编号）",
        "",
        sourceText,
        "",
        "## 任务要求",
        "- 输出合并后的完整笔记，保持六段结构（标题/一句话总结/核心概念/例子/常见误区/延伸问题）。",
        "- 把新对话中值得记录的新知识、新例子、新误区融入对应章节：重复内容去重，矛盾内容以新对话为准并顺带修正旧表述。",
        "- 新增或被新对话实质修改的内容，在句尾追加溯源标记 [[mN]]（N 为新对话片段中真实存在的消息编号）。",
        "- 既有笔记中未受影响的句子保持原样（包括其中的 [[a数字]]）。",
        "- 若新对话没有值得记录的实质内容，只输出四个字母：SKIP",
        "- 只输出 Markdown，不要解释。",
      ].join("\n"),
    },
  ];
}
