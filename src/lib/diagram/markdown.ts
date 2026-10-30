/**
 * 特殊代码围栏在 Markdown 文本中的处理。
 * - diagram（G 批次）：图示 spec；python（M2 批次）：可执行代码卡片。
 * 渲染接线见 components/common/Markdown.tsx。
 */

export const FENCE_LANGS = ["diagram", "python"] as const;

/** 已闭合的 diagram 围栏块（连续非贪婪匹配到第一个闭合围栏；未闭合则到文本末尾） */
const CLOSED_DIAGRAM_RE = /```diagram[ \t]*\r?\n[\s\S]*?(?:```[ \t]*(?:\r?\n|$)|$)/g;

/** 剥离全部 diagram 围栏块（python 代码块保留——它是正向内容）。用于笔记生成源文本，防 JSON 噪声。 */
export function stripDiagramBlocks(md: string): string {
  if (!md.includes("```diagram")) return md;
  return md.replace(CLOSED_DIAGRAM_RE, "");
}

/** 内容是否包含 diagram 围栏块 */
export function hasDiagramContent(md: string): boolean {
  return md.includes("```diagram");
}

const STREAM_PLACEHOLDER: Record<(typeof FENCE_LANGS)[number], string> = {
  diagram: "*📐 图示生成中…*",
  python: "*💻 代码生成中…*",
};

/**
 * 流式渲染保护（ChatView delta 累积 → Markdown）：
 * 尾部开启且未闭合的 diagram / python 围栏替换为占位行，避免 react-markdown 把后续正文当作代码渲染。
 */
export function hideStreamingFence(md: string): string {
  let found: { idx: number; lang: (typeof FENCE_LANGS)[number] } | null = null;
  for (const lang of FENCE_LANGS) {
    const idx = md.lastIndexOf("```" + lang);
    if (idx !== -1 && (!found || idx > found.idx)) found = { idx, lang };
  }
  if (!found) return md;
  const after = md.slice(found.idx + 3 + found.lang.length);
  // 开启之后出现任何游离的 ``` 行 → 已闭合，无需占位
  if (/(?:^|\r?\n)[ \t]*```/.test(after)) return md;
  return md.slice(0, found.idx) + "\n" + STREAM_PLACEHOLDER[found.lang] + "\n";
}
