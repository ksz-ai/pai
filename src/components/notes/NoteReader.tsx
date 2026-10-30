"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MessageDTO, NoteDTO, SSEEvent } from "@/lib/types";
import { formatDate, jsonFetch } from "@/lib/client/api";
import { parseGlossary } from "@/lib/notes/glossary";
import { Markdown } from "@/components/common/Markdown";
import { Spinner } from "@/components/common/EmptyState";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";

/**
 * 笔记阅读视图（FR-05 + B4 划词解答）：
 * - 六段结构渲染，[[mN]] 锚点 → 侧滑显示对话原文
 * - 划词浮层（FR-06）：仅阅读视图、骨架先行、>200 字转总结、防编造、复制出口
 * - 术语表（FR-07）：加入去重、更新解释、5 秒撤销
 * - 编辑冲突（E-11）：双版本保留 + 选择保留
 */
export function NoteReader({ noteId }: { noteId: string }) {
  const router = useRouter();
  const [note, setNote] = useState<NoteDTO | null>(null);
  const [missing, setMissing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [anchor, setAnchor] = useState<{ conversation_id: string | null; slot: number } | null>(null);
  const [sourceMessages, setSourceMessages] = useState<MessageDTO[] | "deleted" | null>(null);

  // ---- 划词状态（FR-06）----
  // x/y 为页面容器内的绝对坐标（锚定文档，随页面滚动，而非固定在视口）
  const [sel, setSel] = useState<{ text: string; x: number; y: number; above: boolean; tooLong: boolean } | null>(null);
  const [selAnswer, setSelAnswer] = useState("");
  const [selPhase, setSelPhase] = useState<"loading" | "streaming" | "done" | "not_found" | "error">("loading");
  const [selError, setSelError] = useState<string | null>(null);
  const [selTermExists, setSelTermExists] = useState<null | "ask_replace" | "added">(null);
  const [undoToast, setUndoToast] = useState<{ prev: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const [conflict, setConflict] = useState<null | { server: NoteDTO }>(null);
  const [copied, setCopied] = useState(false);
  const [domainEditing, setDomainEditing] = useState(false);
  const [domainInput, setDomainInput] = useState("");
  const [knownDomains, setKnownDomains] = useState<string[]>([]);

  const contentRef = useRef<HTMLDivElement | null>(null);
  const pageRef = useRef<HTMLDivElement | null>(null);
  const selAbortRef = useRef<AbortController | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await jsonFetch<{ note: NoteDTO }>(`/api/notes/${noteId}`);
      setNote(d.note);
    } catch {
      setMissing(true);
    }
  }, [noteId]);

  useEffect(() => {
    // 挂载加载：setState 走 Promise 回调（react-hooks/set-state-in-effect 要求）
    jsonFetch<{ note: NoteDTO }>(`/api/notes/${noteId}`)
      .then((d) => setNote(d.note))
      .catch(() => setMissing(true));
  }, [noteId]);

  // 加载锚点指向的会话消息（锚点 v2：每条锚点自带 conversation_id）
  useEffect(() => {
    if (anchor === null || !note) return;
    const convId = anchor.conversation_id;
    const resultP: Promise<{ messages: MessageDTO[] } | "deleted"> =
      !convId || note.status === "source_deleted"
        ? Promise.resolve("deleted" as const)
        : jsonFetch<{ messages: MessageDTO[] }>(`/api/conversations/${convId}`).catch(() => "deleted" as const);
    // 复位与赋值全部在微任务回调里，避免 effect 内同步 setState（react-hooks/set-state-in-effect）
    void Promise.resolve()
      .then(() => setSourceMessages(null))
      .then(() => resultP)
      .then((r) => setSourceMessages(r === "deleted" ? "deleted" : r.messages));
  }, [anchor, note]);

  // 锚点 id → 定位信息（渲染与导出共用）
  const anchorMap = useMemo(() => {
    const m = new Map<string, { conversation_id: string | null; slot: number }>();
    for (const a of note?.anchors ?? []) m.set(a.id, { conversation_id: a.conversation_id, slot: a.slot });
    return m;
  }, [note]);

  // 卸载时中断进行中的划词请求、清除撤销计时
  useEffect(
    () => () => {
      selAbortRef.current?.abort();
      if (undoToast) clearTimeout(undoToast.timer);
    },
    [undoToast],
  );

  const closePopover = useCallback(() => {
    selAbortRef.current?.abort();
    setSel(null);
    setSelAnswer("");
    setSelPhase("loading");
    setSelError(null);
    setSelTermExists(null);
    setCopied(false);
  }, []);

  /** FR-06 ①：仅阅读视图内容区响应 mouseup，不劫持全局选择/复制 */
  const onContentMouseUp = useCallback(
    (e: React.MouseEvent) => {
      if (editing) return;
      if (popoverRef.current?.contains(e.target as Node)) return;
      const selection = window.getSelection();
      const text = selection?.toString().trim() ?? "";
      if (!text || !selection || selection.isCollapsed || !contentRef.current) {
        return; // 收起由浮层自身的关闭/外点处理，避免误清
      }
      const range = selection.getRangeAt(0);
      if (!contentRef.current.contains(range.commonAncestorContainer)) return;

      const rect = range.getBoundingClientRect();
      const pageRect = pageRef.current!.getBoundingClientRect();
      const tooLong = text.length > 200; // FR-06 ④ / E-08
      // 视口内先做水平收拢，再换算为容器内坐标（absolute 定位随文档滚动）
      const viewportLeft = Math.min(Math.max(12, rect.left + rect.width / 2 - 160), window.innerWidth - 352);
      // 选区靠近视口底部时浮层向上翻，避免超出屏幕
      const placeAbove = rect.bottom + 350 > window.innerHeight && rect.top > 350;
      setSel({
        text,
        x: Math.max(0, viewportLeft - pageRect.left),
        y: placeAbove ? rect.top - pageRect.top - 10 : rect.bottom - pageRect.top + 10,
        above: placeAbove,
        tooLong,
      });
      setSelAnswer("");
      setSelPhase("loading");
      setSelError(null);
      setSelTermExists(null);
      setCopied(false);
      if (tooLong) return;

      // 骨架已就位，流式补齐内容（FR-06 ②）
      const controller = new AbortController();
      selAbortRef.current = controller;
      let acc = "";
      void (async () => {
        try {
          const res = await fetch("/api/selection/explain", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ note_id: noteId, text }),
            signal: controller.signal,
          });
          if (!res.ok || !res.body) throw new Error(`请求失败（${res.status}）`);
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          let sawDone = false;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const parts = buffer.split("\n\n");
            buffer = parts.pop() ?? "";
            for (const part of parts) {
              for (const line of part.split("\n")) {
                const t = line.trim();
                if (!t.startsWith("data:")) continue;
                try {
                  const ev = JSON.parse(t.slice(5).trim()) as SSEEvent;
                  if (ev.type === "delta") {
                    acc += ev.text;
                    setSelAnswer(acc);
                    setSelPhase("streaming");
                  } else if (ev.type === "done") {
                    sawDone = true;
                  } else if (ev.type === "error") {
                    setSelPhase("error");
                    setSelError(ev.message);
                  }
                } catch {
                  /* 跳过坏帧 */
                }
              }
            }
          }
          if (sawDone || acc) {
            // 防编造（AC-06-3 / E-07）
            setSelPhase(acc.replace(/[*\s]/g, "").startsWith("未找到相关解释") ? "not_found" : "done");
          } else if (selPhase === "loading") {
            setSelPhase("error");
            setSelError("未获得解答，请重试");
          }
        } catch (err) {
          if ((err as Error).name !== "AbortError") {
            setSelPhase("error");
            setSelError(err instanceof Error ? err.message : "解答失败");
          }
        }
      })();
    },
    [editing, noteId, selPhase],
  );

  async function glossaryAdd(replace: boolean) {
    if (!note || !sel) return;
    try {
      const r = await jsonFetch<{ exists: boolean; note: NoteDTO }>(`/api/notes/${note.id}`, {
        method: "PATCH",
        body: JSON.stringify({ glossary_add: { term: sel.text, explanation: selAnswer, replace } }),
      });
      const prev = note.content;
      setNote(r.note);
      if (r.exists && !replace) {
        setSelTermExists("ask_replace"); // FR-07 ③：已存在 → 提供更新解释
        return;
      }
      setSelTermExists("added");
      // FR-07 ④：5 秒内可撤销
      const timer = setTimeout(() => setUndoToast(null), 5000);
      setUndoToast({ prev, timer });
    } catch (e) {
      alert(e instanceof Error ? e.message : "加入失败");
    }
  }

  async function undoGlossaryAdd() {
    if (!note || !undoToast) return;
    clearTimeout(undoToast.timer);
    try {
      await jsonFetch(`/api/notes/${note.id}`, {
        method: "PATCH",
        body: JSON.stringify({ content: undoToast.prev, force: true }),
      });
      await load();
    } catch {
      /* 撤销失败不打断 */
    }
    setUndoToast(null);
  }

  function openDomainEditor() {
    if (!note) return;
    setDomainInput(note.domain);
    setDomainEditing(true);
    jsonFetch<{ domains: { domain: string }[] }>("/api/notes")
      .then((d) => setKnownDomains(d.domains.map((x) => x.domain)))
      .catch(() => setKnownDomains([]));
  }

  async function saveDomain(domain: string) {
    if (!note || !domain.trim()) return;
    try {
      await jsonFetch(`/api/notes/${note.id}`, { method: "PATCH", body: JSON.stringify({ domain: domain.trim() }) });
      setDomainEditing(false);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "分类设置失败");
    }
  }

  /** [[aK]] → 可点击锚点链接（按映射解析；映射外 token 渲染为空） */
  const renderedContent = useMemo(() => {
    if (!note) return "";
    return note.content.replace(/\[\[([^\[\]]+)\]\]/g, (m, id: string) => {
      const a = anchorMap.get(id);
      return a ? `[¶${a.slot}](#anchor-${id})` : "";
    });
  }, [note, anchorMap]);

  async function saveEdit() {
    if (!note || !editValue.trim()) return;
    try {
      const res = await fetch(`/api/notes/${note.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editValue.trim(), base_version: note.version }),
      });
      if (res.status === 409) {
        const d = (await res.json()) as { note: NoteDTO };
        setConflict({ server: d.note }); // E-11：另一窗口已修改
        return;
      }
      const d = (await res.json()) as { note?: NoteDTO; error?: string };
      if (!res.ok || !d.note) throw new Error(d.error ?? "保存失败");
      setNote(d.note);
      setEditing(false);
    } catch (e) {
      alert(e instanceof Error ? e.message : "保存失败");
    }
  }

  async function keepMine() {
    if (!conflict || !note) return;
    try {
      const d = await jsonFetch<{ note: NoteDTO }>(`/api/notes/${note.id}`, {
        method: "PATCH",
        body: JSON.stringify({ content: editValue.trim(), force: true }),
      });
      setNote(d.note);
      setEditing(false);
    } catch (e) {
      alert(e instanceof Error ? e.message : "保存失败");
    }
    setConflict(null);
  }

  async function exportNote() {
    if (!note) return;
    const date = new Date().toISOString().slice(0, 10);
    // 锚点 v2：按映射逐个解析（跨会话合并后各锚点指向不同会话）
    const md = note.content.replace(/\[\[([^\[\]]+)\]\]/g, (m, id: string) => {
      const a = anchorMap.get(id);
      if (!a) return "";
      return a.conversation_id
        ? `[↩ 对话第 ${a.slot} 条](/chat/${a.conversation_id}?slot=${a.slot})`
        : `（对话第 ${a.slot} 条，来源已删除）`;
    });
    const blob = new Blob([`# ${note.title}\n\n${md.replace(/^#[^\n]*\n/, "")}\n`], {
      type: "text/markdown;charset=utf-8",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${note.title.replace(/[\\/:*?"<>|]/g, "")}-${date}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
    await jsonFetch(`/api/notes/${note.id}`, { method: "PATCH", body: JSON.stringify({ mark_exported: true }) }).catch(() => {});
    load();
  }

  async function confirmDelete() {
    if (!note) return;
    await jsonFetch(`/api/notes/${note.id}`, { method: "DELETE" }).catch(() => {});
    router.push("/notes");
  }

  if (missing) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center text-text3">
        笔记不存在。
        <Link href="/notes" className="ml-2 text-accent hover:underline">
          返回列表
        </Link>
      </div>
    );
  }
  if (!note) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Spinner label="加载笔记…" />
      </div>
    );
  }

  const anchorMessage =
    anchor !== null && Array.isArray(sourceMessages)
      ? sourceMessages.find((m) => m.slot_index === anchor.slot)
      : null;

  const glossaryCount = note ? parseGlossary(note.content).length : 0;

  return (
    <div
      ref={pageRef}
      className="relative mx-auto max-w-3xl px-4 py-8"
      onClick={(e) => {
        // 点击浮层内部不关闭（浮层自带 stopPropagation，双保险）
        if (popoverRef.current?.contains(e.target as Node)) return;
        // 关键：真实浏览器在 mouseup 后会补发一次 click——此刻选区仍在，
        // 不能据此关闭浮层（否则划词浮层刚打开就被吞掉）
        const activeSel = (window.getSelection()?.toString() ?? "").trim();
        if (activeSel || !sel) return;
        closePopover();
      }}
    >
      {/* 头部 */}
      <div className="mb-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-white">{note.title}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-text3">
              {note.status === "source_deleted" ? (
                <span className="text-warn">来源会话已删除</span>
              ) : note.conversation_id ? (
                <Link href={`/chat/${note.conversation_id}`} className="text-accent hover:underline">
                  来源：{note.source_title ?? "对话"}
                </Link>
              ) : (
                <span>独立笔记</span>
              )}
              <span>v{note.version}</span>
              <span>{formatDate(note.updated_at)}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (domainEditing) setDomainEditing(false);
                  else openDomainEditor();
                }}
                className="rounded bg-panel2 px-1.5 py-0.5 text-text2 hover:text-accent"
                title="点击修改分类（手动设置后不被自动归类覆盖）"
              >
                🏷 {note.domain}{note.domain_locked ? " · 手动" : ""}
              </button>
              {glossaryCount > 0 && <span>术语表 {glossaryCount} 条</span>}
              {note.status === "exported" && <span className="rounded border border-accent2/40 px-1.5 py-0.5 text-accent2">已导出</span>}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            {editing ? (
              <>
                <button onClick={() => setEditing(false)} className="rounded-md border border-border px-3 py-1.5 text-xs text-text2 hover:bg-panel2">
                  取消
                </button>
                <button onClick={saveEdit} className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-bg">
                  保存（v{note.version + 1}）
                </button>
              </>
            ) : (
              <>
                <button onClick={exportNote} className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-bg hover:opacity-90">
                  导出 Markdown
                </button>
                <Link
                  href={`/review?note=${note.id}`}
                  className="rounded-md border border-border px-3 py-1.5 text-xs text-text2 hover:border-accent hover:text-accent"
                  title="用本笔记的卡片自评复习"
                >
                  复习
                </Link>
                <button
                  onClick={() => {
                    setEditValue(note.content);
                    setEditing(true);
                  }}
                  className="rounded-md border border-border px-3 py-1.5 text-xs text-text2 hover:border-accent hover:text-accent"
                >
                  编辑
                </button>
                <button onClick={() => setDeleting(true)} className="rounded-md border border-border px-3 py-1.5 text-xs text-text3 hover:border-danger hover:text-danger">
                  删除
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* 领域行内编辑器（分类体系优化：自定义分类，保存后锁定） */}
      {domainEditing && note && (
        <div className="mb-3 rounded-lg border border-accent/40 bg-panel px-3.5 py-3 text-xs" onClick={(e) => e.stopPropagation()}>
          <p className="mb-2 text-text2">
            设置《{note.title.slice(0, 20)}》的分类
            <span className="ml-1 text-text3">（手动设置后不被自动归类覆盖；可输入新分类名）</span>
          </p>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {[...new Set([note.domain, ...knownDomains])].map((d) => (
              <button
                key={d}
                onClick={() => setDomainInput(d)}
                className={`rounded border px-2 py-0.5 transition-colors ${
                  domainInput === d ? "border-accent bg-accent/15 text-accent" : "border-border text-text2 hover:text-text"
                }`}
              >
                {d}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              value={domainInput}
              onChange={(e) => setDomainInput(e.target.value)}
              placeholder="分类名称，如：计算机科学"
              className="flex-1 rounded-md border border-border bg-panel2 px-2.5 py-1.5 text-text focus:border-accent focus:outline-none"
              onKeyDown={(e) => {
                if (e.key === "Enter" && domainInput.trim()) void saveDomain(domainInput);
              }}
            />
            <button
              onClick={() => void saveDomain(domainInput)}
              disabled={!domainInput.trim()}
              className="rounded-md bg-accent px-3 py-1.5 font-medium text-bg disabled:opacity-40"
            >
              保存
            </button>
            <button onClick={() => setDomainEditing(false)} className="rounded-md border border-border px-3 py-1.5 text-text2">
              取消
            </button>
          </div>
        </div>
      )}

      {/* 5 秒撤销条（FR-07 ④） */}
      {undoToast && (
        <div className="mb-3 flex items-center justify-between rounded-md border border-teal/40 bg-teal/10 px-3 py-2 text-xs text-teal" onClick={(e) => e.stopPropagation()}>
          <span>术语已加入术语表</span>
          <span className="flex items-center gap-3">
            <button onClick={undoGlossaryAdd} className="font-medium underline underline-offset-2">
              撤销
            </button>
            <button onClick={() => setUndoToast(null)} className="text-text3 hover:text-text">
              ×
            </button>
          </span>
        </div>
      )}

      {/* 划词引导（可发现性）：常显轻提示条 */}
      {!editing && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-teal/30 bg-teal/10 px-3.5 py-2 text-xs text-teal">
          <span>💡</span>
          <span>
            用鼠标<strong>划选正文中的任意术语</strong>，可即时获得按你水平调整的解答——支持加入术语表、深入讲解、换种说法
          </span>
        </div>
      )}

      {/* 正文（划词作用域，FR-06 ①） */}
      {editing ? (
        <textarea
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          className="h-[60vh] w-full rounded-xl border border-border bg-panel p-4 font-mono text-sm leading-relaxed text-text focus:border-accent focus:outline-none"
          spellCheck={false}
        />
      ) : (
        <div
          ref={contentRef}
          className="rounded-xl border border-border bg-panel px-6 py-5"
          onMouseUp={onContentMouseUp}
          onClick={(e) => {
            const a = (e.target as HTMLElement).closest("a");
            if (a && a.getAttribute("href")?.startsWith("#anchor-")) {
              e.preventDefault();
              const id = a.getAttribute("href")!.slice("#anchor-".length);
              const target = anchorMap.get(id);
              if (target) setAnchor(target);
            }
          }}
        >
          <Markdown>{renderedContent}</Markdown>
        </div>
      )}

      {!editing && note.anchors.length > 0 && (
        <p className="mt-3 text-center text-xs text-text3">
          正文中的 ¶N 为溯源锚点，点击可在侧边查看对话原文；阅读时划选任意术语可获得即时解答
        </p>
      )}

      {/* 划词浮层（FR-06 ③）：absolute 锚定文档，随页面滚动；靠近底部时向上翻 */}
      {sel && !editing && (
        <div
          ref={popoverRef}
          className="absolute z-50 w-80 rounded-xl border border-accent/50 bg-panel p-3.5 shadow-2xl"
          style={{
            left: sel.x,
            top: sel.y,
            ...(sel.above ? { transform: "translateY(-100%)" } : {}),
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="truncate text-xs font-medium text-accent">“{sel.text.slice(0, 24)}{sel.text.length > 24 ? "…" : ""}”</span>
            <button onClick={closePopover} className="shrink-0 text-text3 hover:text-text">
              ×
            </button>
          </div>

          {sel.tooLong ? (
            /* AC-06-2 / E-08：超长不解释，改提示总结 */
            <div className="py-1 text-sm text-text2">
              <p>选中的内容超过 200 字，不适合简短解释。</p>
              <div className="mt-2 flex gap-2">
                {note.conversation_id && note.status !== "source_deleted" ? (
                  <Link
                    href={`/chat/${note.conversation_id}?ask=${encodeURIComponent(`请总结这段内容：${sel.text.slice(0, 120)}…`)}`}
                    className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-bg"
                  >
                    转入对话总结
                  </Link>
                ) : (
                  <span className="text-xs text-text3">来源会话已删除，无法转入对话</span>
                )}
                <button onClick={closePopover} className="rounded-md border border-border px-3 py-1.5 text-xs text-text2">
                  取消
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="max-h-48 overflow-y-auto text-sm leading-relaxed text-text">
                {selPhase === "loading" && <Spinner label="正在解答…" />}
                {selPhase === "not_found" && (
                  <div className="text-warn">
                    <p>未找到相关解释。</p>
                    <p className="mt-1 text-xs text-text3">试试选中完整的术语，或在对话中直接提问。</p>
                  </div>
                )}
                {selPhase === "error" && <p className="text-danger">{selError}</p>}
                {(selPhase === "streaming" || selPhase === "done") && (
                  <div className={selPhase === "streaming" ? "stream-cursor" : ""}>
                    <Markdown>{selAnswer}</Markdown>
                  </div>
                )}
              </div>

              <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-2 text-xs">
                <button
                  onClick={() => glossaryAdd(false)}
                  disabled={selPhase !== "done" || selTermExists !== null}
                  className="rounded border border-border px-2 py-1 text-text2 hover:border-accent hover:text-accent disabled:opacity-40"
                >
                  加入笔记
                </button>
                {note.conversation_id && note.status !== "source_deleted" ? (
                  <Link
                    href={`/chat/${note.conversation_id}?ask=${encodeURIComponent(`请深入讲解「${sel.text}」`)}`}
                    className="rounded border border-border px-2 py-1 text-text2 hover:border-accent hover:text-accent"
                  >
                    深入讲解
                  </Link>
                ) : (
                  <span className="rounded border border-border/50 px-2 py-1 text-text3">深入讲解（来源已删除）</span>
                )}
                <button
                  onClick={() => {
                    const text = sel.text;
                    closePopover();
                    setTimeout(() => {
                      setSel({ text, x: sel.x, y: sel.y, above: sel.above, tooLong: false });
                      setSelPhase("loading");
                      // 触发 rephrase 请求
                      void (async () => {
                        const controller = new AbortController();
                        selAbortRef.current = controller;
                        try {
                          const res = await fetch("/api/selection/explain", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ note_id: noteId, text, rephrase: true }),
                            signal: controller.signal,
                          });
                          const reader = res.body!.getReader();
                          const decoder = new TextDecoder();
                          let acc = "";
                          let buffer = "";
                          while (true) {
                            const { done, value } = await reader.read();
                            if (done) break;
                            buffer += decoder.decode(value, { stream: true });
                            const parts = buffer.split("\n\n");
                            buffer = parts.pop() ?? "";
                            for (const part of parts) {
                              for (const line of part.split("\n")) {
                                const t = line.trim();
                                if (!t.startsWith("data:")) continue;
                                const ev = JSON.parse(t.slice(5).trim()) as SSEEvent;
                                if (ev.type === "delta") {
                                  acc += ev.text;
                                  setSelAnswer(acc);
                                  setSelPhase("streaming");
                                } else if (ev.type === "done" && acc) {
                                  setSelPhase(acc.replace(/[*\s]/g, "").startsWith("未找到相关解释") ? "not_found" : "done");
                                }
                              }
                            }
                          }
                        } catch {
                          /* 用户可能已关闭 */
                        }
                      })();
                    }, 0);
                  }}
                  disabled={selPhase !== "done"}
                  className="rounded border border-border px-2 py-1 text-text2 hover:border-accent hover:text-accent disabled:opacity-40"
                >
                  换种说法
                </button>
                <button
                  onClick={() => {
                    void navigator.clipboard.writeText(sel.text);
                    setCopied(true);
                  }}
                  className="rounded px-2 py-1 text-text3 hover:text-text"
                  title="复制原文"
                >
                  {copied ? "已复制 ✓" : "复制原文"}
                </button>
              </div>

              {/* FR-07 ③：术语已存在 */}
              {selTermExists === "ask_replace" && (
                <div className="mt-2 rounded-md border border-warn/40 bg-warn/10 px-2.5 py-2 text-xs text-warn">
                  <p>该术语已在术语表中。</p>
                  <div className="mt-1.5 flex gap-2">
                    <button onClick={() => glossaryAdd(true)} className="rounded bg-warn/80 px-2 py-1 font-medium text-bg">
                      更新解释
                    </button>
                    <button onClick={() => setSelTermExists(null)} className="rounded border border-border px-2 py-1 text-text2">
                      跳过
                    </button>
                  </div>
                </div>
              )}
              {selTermExists === "added" && <p className="mt-2 text-xs text-accent2">已加入术语表，可在上方 5 秒内撤销</p>}
            </>
          )}
        </div>
      )}

      {/* E-11 冲突对话框 */}
      <ConfirmDialog
        open={Boolean(conflict)}
        title="检测到另一窗口的修改"
        message={`该笔记在其他窗口已被修改（当前为 v${conflict?.server.version}）。两个版本都已保留，请选择保留哪个。`}
        confirmText="保留我的版本"
        onConfirm={keepMine}
        onCancel={() => {
          setConflict(null);
          setEditing(false);
          load();
        }}
      >
        <p className="mt-2 rounded-md bg-panel2 px-3 py-2 text-xs text-text3">
          选「保留我的版本」将以你正在编辑的内容覆盖（对方版本存入历史）；取消则重新加载最新版本。
        </p>
      </ConfirmDialog>

      {/* 锚点侧滑（锚点 v2：各锚点可指向不同会话） */}
      {anchor !== null && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={() => setAnchor(null)}>
          <div
            className="flex h-full w-full max-w-md flex-col border-l border-border bg-panel p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">对话原文 · 第 {anchor.slot} 条</h3>
              <button onClick={() => setAnchor(null)} className="text-text3 hover:text-text">
                ×
              </button>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto pr-1">
              {sourceMessages === null && <Spinner label="加载原文…" />}
              {sourceMessages === "deleted" && <p className="text-sm text-text3">来源会话已被删除，无法查看原文。</p>}
              {Array.isArray(sourceMessages) && !anchorMessage && (
                <p className="text-sm text-text3">未找到第 {anchor.slot} 条消息（可能来自被折叠的版本）。</p>
              )}
              {anchorMessage && (
                <>
                  <div className="rounded-lg border border-accent/50 bg-panel2 p-3 text-sm leading-relaxed">
                    <p className="mb-1 text-[11px] text-accent">{anchorMessage.role === "user" ? "学习者" : "AI 导师"}</p>
                    <div className="max-h-72 overflow-y-auto text-text">
                      <Markdown>{anchorMessage.content}</Markdown>
                    </div>
                  </div>
                  <p className="text-center text-xs text-text3">↑ 溯源锚点指向的原文</p>
                </>
              )}
            </div>
            {anchor.conversation_id && note.status !== "source_deleted" && (
              <Link
                href={`/chat/${anchor.conversation_id}?slot=${anchor.slot}`}
                className="mt-3 rounded-md border border-border py-2 text-center text-xs text-text2 hover:border-accent hover:text-accent"
              >
                在对话中查看完整上下文 →
              </Link>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={deleting}
        title="删除笔记？"
        message="笔记将被彻底删除，且不影响来源对话。"
        confirmText="删除"
        danger
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(false)}
      />
    </div>
  );
}
