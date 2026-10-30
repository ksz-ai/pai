export const MULTI_MERGE_PROMPT_VERSION = "multi-merge-v1";

export function buildMultiMergeMessages(sources: { title: string; content: string }[]) {
  const sourceBlock = sources
    .map((s, i) => `## 来源笔记 ${i + 1}：《${s.title}》\n\n${s.content}`)
    .join("\n\n---\n\n");

  return [
    {
      role: "system" as const,
      content: [
        "你是笔记合并器。学习者把多篇同主题的学习笔记交给你，要合成一份主题总纲。",
        "",
        "## 来源笔记",
        "（其中 [[s数字a数字]] 形式的标记是溯源锚点，指向原始对话——【输出中可以原样引用它们，但不要发明新标记】）",
        "",
        sourceBlock,
        "",
        "## 任务要求",
        "- 输出一份全新的主题总纲，保持六段结构（# 总纲标题 / 一句话总结 / 核心概念 / 例子 / 常见误区 / 延伸问题）。",
        "- 跨笔记去重：同一概念多篇都讲了的，融合成一条更完整的表述；表述矛盾的，取更准确的一方或并列说明分歧。",
        "- 核心概念句尾可保留来源笔记中的 [[s数字a数字]] 溯源标记（原样复制，让学习者能跳回原文）。",
        "- 补充「来源笔记」清单：在正文最后加一段「## 来源」，逐行列出合并了哪几篇（用《标题》列出）。",
        "- 只输出 Markdown，不要解释。",
      ].join("\n"),
    },
  ];
}
