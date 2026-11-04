"use client";

import { useRef, useState } from "react";
import { postSSE } from "@/lib/client/api";
import { jsonFetch } from "@/lib/client/api";

/**
 * 与笔记对话面板（SPEC M2-3）：基于本篇笔记的流式问答，临时会话；
 * 「存入笔记」把 Q/A 追加到延伸问题章节。
 */
export function NoteAskPanel({
  noteId,
  noteTitle,
  onClose,
  onSaved,
}: {
  noteId: string;
  noteTitle: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [messages, setMessages] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  function scrollBottom() {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    });
  }

  async function ask(question: string) {
    if (streaming || !question.trim()) return;
    const history = messages.slice(-10);
    setMessages((m) => [...m, { role: "user", content: question }, { role: "assistant", content: "" }]);
    setStreaming(true);
    setSaveState("idle");
    scrollBottom();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await postSSE(
        `/api/notes/${noteId}/ask`,
        { question, history },
        (ev) => {
          if (ev.type === "delta") {
            setMessages((m) => {
              const next = [...m];
              next[next.length - 1] = { role: "assistant", content: next[next.length - 1].content + (ev.text ?? "") };
              return next;
            });
            scrollBottom();
          } else if (ev.type === "error") {
            setMessages((m) => {
              const next = [...m];
              next[next.length - 1] = { role: "assistant", content: `⚠️ ${ev.message ?? "回答失败"}` };
              return next;
            });
          }
        },
        controller.signal,
      );
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  /** 把最后一轮 Q/A 追加到笔记延伸问题章节 */
  async function saveIntoNote() {
    if (saveState !== "idle" || messages.length < 2) return;
    const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const lastAi = [...messages].reverse().find((m) => m.role === "assistant")?.content ?? "";
    if (!lastUser || !lastAi) return;
    setSaveState("saving");
    try {
      await jsonFetch(`/api/notes/${noteId}`, {
        method: "PATCH",
        body: JSON.stringify({ append_qa: { question: lastUser, answer: lastAi } }),
      });
      setSaveState("saved");
      onSaved();
    } catch (e) {
      alert(e instanceof Error ? e.message : "存入失败");
      setSaveState("idle");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-[460px] flex-col border-l border-border bg-panel"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white">与笔记对话</p>
            <p className="truncate text-[11px] text-text3">基于《{noteTitle.slice(0, 20)}{noteTitle.length > 20 ? "…" : ""}》回答 · 临时会话</p>
          </div>
          <div className="flex items-center gap-2">
            {messages.length >= 2 && saveState !== "saved" && (
              <button
                onClick={() => void saveIntoNote()}
                disabled={saveState === "saving" || streaming}
                className="rounded-md border border-accent/50 px-2.5 py-1 text-[11px] text-accent hover:bg-accent/10 disabled:opacity-40"
              >
                {saveState === "saving" ? "存入中…" : "存入笔记"}
              </button>
            )}
            {saveState === "saved" && <span className="text-[11px] text-accent2">已存入 ✓</span>}
            <button onClick={onClose} className="text-text3 hover:text-text">
              ×
            </button>
          </div>
        </div>

        {/* 消息流 */}
        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
          {messages.length === 0 && (
            <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-text3">
              问问这篇笔记讲了什么、某个概念再解释一遍、或者追问一个没懂的地方
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
              <div
                className={`max-w-[85%] rounded-lg px-3 py-2 text-sm leading-relaxed ${
                  m.role === "user" ? "bg-accent/15 text-text" : "border border-border bg-panel2/60 text-text"
                }`}
              >
                {m.content || (streaming && i === messages.length - 1 ? "…" : "")}
              </div>
            </div>
          ))}
          {streaming && messages[messages.length - 1]?.role === "assistant" && !messages[messages.length - 1].content && (
            <div className="text-xs text-text3">思考中…</div>
          )}
        </div>

        {/* 输入 */}
        <div className="border-t border-border p-3">
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  const q = input.trim();
                  setInput("");
                  void ask(q);
                }
              }}
              rows={2}
              placeholder="基于这篇笔记提问…（Enter 发送）"
              className="flex-1 resize-none rounded-lg border border-border bg-panel2 px-3 py-2 text-sm text-text placeholder:text-text3 focus:border-accent focus:outline-none"
            />
            <button
              onClick={() => {
                const q = input.trim();
                setInput("");
                void ask(q);
              }}
              disabled={streaming || !input.trim()}
              className="rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-bg disabled:opacity-40"
            >
              发送
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
