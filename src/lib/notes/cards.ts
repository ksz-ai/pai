import { parseGlossary } from "@/lib/notes/glossary";

export interface ReviewCard {
  front: string;
  back: string;
  anchorId: string | null;
  source: "concept" | "glossary";
}

/** 从笔记抽取复习卡片（无 LLM）：核心概念段 + 术语表，front 去重（核心概念优先） */
export function extractCards(content: string): ReviewCard[] {
  const cards: ReviewCard[] = [];
  const lines = content.split("\n");
  let inSection = false;
  for (const line of lines) {
    const t = line.trim();
    if (t === "## 核心概念") {
      inSection = true;
      continue;
    }
    if (inSection && /^#{2,3}\s/.test(t)) break;
    const m = inSection ? t.match(/^-\s*\*\*(.+?)\*\*[：:]\s*(.*)$/) : null;
    if (m) {
      const anchor = m[2].match(/\[\[([^\[\]]+)\]\]/)?.[1] ?? null;
      cards.push({
        front: m[1].trim(),
        back: m[2].replace(/\[\[[^\[\]]+\]\]/g, "").trim(),
        anchorId: anchor,
        source: "concept",
      });
    }
  }
  for (const g of parseGlossary(content)) {
    cards.push({ front: g.term, back: g.explanation, anchorId: null, source: "glossary" });
  }
  const seen = new Set<string>();
  return cards.filter((c) => {
    if (!c.front || seen.has(c.front)) return false;
    seen.add(c.front);
    return true;
  });
}
