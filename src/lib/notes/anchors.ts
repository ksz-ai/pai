import type { NoteAnchor } from "@/lib/types";

/**
 * 锚点 v2（笔记管理 N2）：
 * token 从 [[mN]]（隐含单会话）升级为不透明 [[aK]]，anchors 存 {id, conversation_id, slot} 映射。
 * 跨会话合并（追加/多篇合成）后，每个 token 都能独立跳回各自的会话原文。
 */

const TOKEN_RE = /\[\[m(\d+)\]\]/g;

/** 生成路径：LLM 输出的 [[mN]] 全部来自同一会话 → 改写为 [[aK]]；无效槽位的 token 剔除 */
export function rewriteGenerationAnchors(
  content: string,
  conversationId: string,
  validSlots: Set<number>,
): { content: string; anchors: NoteAnchor[] } {
  const map = new Map<number, string>();
  const newContent = content.replace(TOKEN_RE, (_m, num: string) => {
    const slot = Number(num);
    if (!validSlots.has(slot)) return ""; // 无效锚点剔除（LLM 幻觉引用）
    if (!map.has(slot)) map.set(slot, `a${map.size + 1}`);
    return `[[${map.get(slot)}]]`;
  });
  const anchors: NoteAnchor[] = [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([slot, id]) => ({ id, conversation_id: conversationId, slot }));
  return { content: newContent, anchors };
}

/** 追加路径：把新会话的 [[mN]] 追加进已有映射（既有 [[aK]] 原样保留），id 从现有最大序号续编 */
export function rewriteAppendAnchors(
  mergedContent: string,
  existingAnchors: NoteAnchor[],
  conversationId: string,
  validSlots: Set<number>,
): { content: string; anchors: NoteAnchor[]; added: number } {
  let next = 1;
  for (const a of existingAnchors) {
    const m = /^a(\d+)$/.exec(a.id);
    if (m) next = Math.max(next, Number(m[1]) + 1);
  }
  const map = new Map<number, string>();
  const newContent = mergedContent.replace(TOKEN_RE, (_m, num: string) => {
    const slot = Number(num);
    if (!validSlots.has(slot)) return "";
    if (!map.has(slot)) map.set(slot, `a${next++}`);
    return `[[${map.get(slot)}]]`;
  });
  const added = map.size;
  const newAnchors: NoteAnchor[] = [
    ...existingAnchors,
    ...[...map.entries()].map(([slot, id]) => ({ id, conversation_id: conversationId, slot })),
  ];
  return { content: newContent, anchors: newAnchors, added };
}

/** 多篇合并路径：为每篇源笔记的 token 加独立前缀，构建合并映射；LLM 输出中不存在的 token 由调用方剔除 */
export function prefixSourceAnchors(
  notes: { id: string; content: string; anchors: NoteAnchor[] }[],
): { contents: string[]; anchors: NoteAnchor[]; byToken: Map<string, NoteAnchor> } {
  const anchors: NoteAnchor[] = [];
  const byToken = new Map<string, NoteAnchor>();
  const contents = notes.map((n, ni) =>
    n.content.replace(/\[\[a(\d+)\]\]/g, (_m, num: string) => {
      const src = n.anchors.find((a) => a.id === `a${num}`);
      if (!src) return ""; // 映射外的 token 剔除
      const token = `s${ni + 1}a${num}`;
      if (!byToken.has(token)) {
        const entry = { id: token, conversation_id: src.conversation_id, slot: src.slot };
        anchors.push(entry);
        byToken.set(token, entry);
      }
      return `[[${token}]]`;
    }),
  );
  return { contents, anchors, byToken };
}

/** 校验 LLM 输出：只保留映射内 token，其余（含 [[mN]] 形态的幻觉标记）剔除 */
export function keepKnownTokens(content: string, known: Set<string>): string {
  return content.replace(/\[\[([^\[\]]+)\]\]/g, (m, id: string) => (known.has(id) ? m : ""));
}
