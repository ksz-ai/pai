/**
 * 术语表（FR-07）：笔记内 `## 术语表` 章节的解析与写入。
 * 条目格式：- **术语**：解释
 */

export const GLOSSARY_HEADING = "## 术语表";

export interface GlossaryEntry {
  term: string;
  explanation: string;
}

export function parseGlossary(content: string): GlossaryEntry[] {
  const lines = content.split("\n");
  const entries: GlossaryEntry[] = [];
  let inSection = false;
  for (const line of lines) {
    const t = line.trim();
    if (t === GLOSSARY_HEADING) {
      inSection = true;
      continue;
    }
    if (inSection && /^#{2,3}\s/.test(t)) break; // 下一个章节
    const m = inSection ? t.match(/^-\s*\*\*(.+?)\*\*[：:]\s*(.*)$/) : null;
    if (m) entries.push({ term: m[1].trim(), explanation: m[2].trim() });
  }
  return entries;
}

/** 追加术语条目；已存在同名术语时不修改（FR-07 ③ 禁止重复条目），由调用方决定是否替换 */
export function addGlossaryEntry(content: string, term: string, explanation: string): { content: string; exists: boolean; previous?: string } {
  const existing = parseGlossary(content).find((e) => e.term === term);
  if (existing) return { content, exists: true, previous: existing.explanation };

  const entryLine = `- **${term}**：${explanation}`;
  let lines = content.split("\n");
  const headingIdx = lines.findIndex((l) => l.trim() === GLOSSARY_HEADING);

  if (headingIdx === -1) {
    // 章节不存在：文末追加
    lines = [...lines, "", GLOSSARY_HEADING, entryLine];
  } else {
    // 插入到术语表章节末尾（下一个章节标题之前 / 文件末尾）
    let insertAt = lines.length;
    for (let i = headingIdx + 1; i < lines.length; i++) {
      if (/^#{2,3}\s/.test(lines[i].trim())) {
        insertAt = i;
        break;
      }
    }
    lines.splice(insertAt, 0, entryLine);
  }
  return { content: lines.join("\n"), exists: false };
}

/** 更新已有术语的解释（FR-07 ③「更新解释」）。只在术语表章节内替换，避免误改正文中的同名加粗行 */
export function upsertGlossaryEntry(content: string, term: string, explanation: string): string {
  const added = addGlossaryEntry(content, term, explanation);
  if (!added.exists) return added.content;

  const lines = content.split("\n");
  let inSection = false;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t === GLOSSARY_HEADING) {
      inSection = true;
      continue;
    }
    if (inSection && /^#{2,3}\s/.test(t)) break; // 术语表章节结束
    if (inSection && t.startsWith(`- **${term}**`)) {
      lines[i] = `- **${term}**：${explanation}`;
      return lines.join("\n");
    }
  }
  return added.content;
}
