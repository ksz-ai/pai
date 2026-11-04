export const NOTE_ASK_PROMPT_VERSION = "note-ask-v1";

export function buildNoteAskMessages(noteContent: string, noteTitle: string, masteryHint: string, history: { role: "user" | "assistant"; content: string }[], question: string) {
  const historyText =
    history.length > 0
      ? "\n## 本面板此前的对话\n" + history.map((h) => `${h.role === "user" ? "学习者" : "你"}：${h.content.slice(0, 400)}`).join("\n") + "\n"
      : "";

  return [
    {
      role: "system" as const,
      content: [
        "你是笔记助手。学习者正在阅读自己的学习笔记，基于笔记内容回答问题、帮助理解。",
        "",
        "## 笔记全文",
        `《${noteTitle}》`,
        noteContent,
        "",
        `## 学习者画像提示\n${masteryHint}`,
        historyText,
        "## 回答要求",
        "- 优先基于笔记内容回答；引用时用「笔记里提到…」的语气。",
        "- 若问题超出笔记覆盖范围：先明确说「笔记里没讲到」，再用通用知识简短补充（标注这是一般性说明）。",
        "- 结合学习者掌握度调整深浅；数学公式用 LaTeX（$...$ / $$...$$）。",
        "- 简洁为主：3–6 句 + 必要的列表，不重复笔记原文大段照抄。",
      ].join("\n"),
    },
    { role: "user" as const, content: question },
  ];
}
