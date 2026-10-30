"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FeedbackKind, MessageDTO, MessageMeta, SSEEvent } from "@/lib/types";
import { DEPTH_LABELS } from "@/lib/types";
import { formatDate, jsonFetch, postSSE, notifyDone, requestNotifyPermission } from "@/lib/client/api";
import { PERSONAS, personaLabel } from "@/lib/client/personas";
import { Markdown } from "@/components/common/Markdown";
import { Spinner } from "@/components/common/EmptyState";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";

interface ConvInfo {
  id: string;
  title: string;
  updated_at: string;
}

interface StreamState {
  id: string | null;
  text: string;
  meta: MessageMeta | null;
  /** 替换哪个 slot 的显示（null = 追加在末尾） */
  targetSlot: number | null;
}

const FEEDBACKS: { kind: FeedbackKind; label: string }[] = [
  { kind: "more_detail", label: "再详细些" },
  { kind: "too_verbose", label: "太啰嗦" },
  { kind: "rephrase", label: "换种讲法" },
];

export function ChatView({ convId, focusSlot, initialInput }: { convId: string; focusSlot: number | null; initialInput?: string }) {
  const router = useRouter();
  const [conv, setConv] = useState<ConvInfo | null>(null);
  const [messages, setMessages] = useState<MessageDTO[]>([]);
  const [profileCount, setProfileCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState(initialInput ?? "");
  const [bannerCode, setBannerCode] = useState<string | null>(null);
  const [stream, setStream] = useState<StreamState | null>(null);
  const [notices, setNotices] = useState<string[]>([]);
  const [banner, setBanner] = useState<string | null>(null);
  const [noteBusy, setNoteBusy] = useState(false);
  const [noteDialog, setNoteDialog] = useState(false);
  const [noteMode, setNoteMode] = useState<"new" | "merge">("new");
  const [noteRange, setNoteRange] = useState("");
  const [mergeTarget, setMergeTarget] = useState("");
  const [existingNotes, setExistingNotes] = useState<{ id: string; title: string }[]>([]);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [editAsk, setEditAsk] = useState<{ nextAssistantId: string | null; replyToId: string; slot: number } | null>(null);
  const [regenConfirm, setRegenConfirm] = useState<{ messageId: string; slot: number } | null>(null);
  const [historySlot, setHistorySlot] = useState<number | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const [persona, setPersona] = useState("general");
  const [personaMenu, setPersonaMenu] = useState(false);
  /** 保存切换人格所需的当前服务配置（PUT 校验要求非空，Key 留空即保留） */
  const llmRef = useRef<{ base_url: string; model: string }>({ base_url: "", model: "" });
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const focusRef = useRef<HTMLDivElement | null>(null);

  /** 纯取数（不含 setState），供挂载加载与刷新共用 */
  const fetchConversation = useCallback(() => {
    return jsonFetch<{ conversation: ConvInfo; messages: MessageDTO[] }>(`/api/conversations/${convId}`);
  }, [convId]);

  /** 刷新：流式结束/编辑/重新生成等动作后调用 */
  const load = useCallback(() => {
    return fetchConversation()
      .then((data) => {
        setConv(data.conversation);
        setMessages(data.messages);
      })
      .catch((e) => setBanner(e instanceof Error ? e.message : "加载失败"))
      .finally(() => setLoading(false));
  }, [fetchConversation]);

  useEffect(() => {
    // 挂载加载：setState 全部走 Promise 回调（react-hooks/set-state-in-effect 要求）
    fetchConversation()
      .then((data) => {
        setConv(data.conversation);
        setMessages(data.messages);
      })
      .catch((e) => setBanner(e instanceof Error ? e.message : "加载失败"))
      .finally(() => setLoading(false));
    jsonFetch<unknown[]>("/api/profile").then((d) => setProfileCount(Array.isArray(d) ? d.length : 0)).catch(() => {});
    // 加载当前人格与服务配置（切换时 PUT 需要 base_url/model 非空）
    jsonFetch<{ tutor_persona?: string; base_url?: string; model?: string }>("/api/settings/llm")
      .then((d) => {
        setPersona(d.tutor_persona ?? "general");
        llmRef.current = { base_url: d.base_url ?? "", model: d.model ?? "" };
      })
      .catch(() => {});
  }, [fetchConversation]);

  /** 对话内切换人格：即时保存，下一条讲解生效 */
  async function switchPersona(id: string) {
    setPersonaMenu(false);
    if (id === persona) return;
    setPersona(id);
    try {
      await jsonFetch("/api/settings/llm", {
        method: "PUT",
        body: JSON.stringify({ ...llmRef.current, tutor_persona: id }),
      });
      pushNotice(`已切换为「${personaLabel(id)}」，下一条讲解生效`);
    } catch (e) {
      setPersona(persona);
      setBanner(e instanceof Error ? e.message : "人格切换失败");
    }
  }

  // 新消息自动滚动到底
  useEffect(() => {
    if (stream && !focusRef.current) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [stream]);

  // 从笔记锚点跳入：定位并高亮
  useEffect(() => {
    if (!loading && focusSlot !== null) {
      requestAnimationFrame(() => {
        focusRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    }
  }, [loading, focusSlot]);

  const pushNotice = (msg: string) => {
    setNotices((n) => [...n.slice(-2), msg]);
    setTimeout(() => setNotices((n) => n.filter((x) => x !== msg)), 8000);
  };

  async function runSSE(
    body: Record<string, unknown>,
    targetSlot: number | null,
    confirmText: { userText?: string } = {},
  ) {
    setBanner(null);
    setStream({ id: null, text: "", meta: null, targetSlot });
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await postSSE(
        "/api/chat/regenerate",
        body,
        (ev: SSEEvent) => handleEvent(ev, confirmText.userText),
        controller.signal,
      );
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setBanner(e instanceof Error ? e.message : "请求失败");
      }
    } finally {
      abortRef.current = null;
      setStream(null);
      await load();
    }
  }

  async function send() {
    const content = input.trim();
    if (!content || stream) return;
    setInput("");
    // 乐观显示用户消息
    setMessages((prev) => [
      ...prev,
      {
        id: `local-${Date.now()}`,
        conversation_id: convId,
        role: "user",
        content,
        slot_index: -1,
        revision: 1,
        status: "normal",
        meta: null,
        has_history: false,
        edited_from: null,
        created_at: new Date().toISOString(),
      },
    ]);
    setStream({ id: null, text: "", meta: null, targetSlot: null });
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await postSSE("/api/chat", { conversation_id: convId, content }, (ev) => handleEvent(ev, content), controller.signal);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setBanner(e instanceof Error ? e.message : "发送失败");
    } finally {
      abortRef.current = null;
      setStream(null);
      await load();
    }
  }

  function handleEvent(ev: SSEEvent, userText?: string) {
    if (ev.type === "meta") {
      setStream((s) =>
        s ? { ...s, id: ev.assistant_message_id, meta: { ...evToMeta(ev), model: s.meta?.model } } : s,
      );
    } else if (ev.type === "delta") {
      setStream((s) => (s ? { ...s, text: s.text + ev.text } : s));
    } else if (ev.type === "notice") {
      pushNotice(ev.message);
    } else if (ev.type === "done") {
      setStream((s) => (s ? { ...s, id: ev.assistant_message_id } : s));
      if (ev.profile_updates.length > 0) pushNotice(`画像更新：${ev.profile_updates.join("；")}`);
    } else if (ev.type === "error") {
      setBanner(ev.message);
      setBannerCode(ev.code ?? null);
    }
    void userText;
  }

  function stop() {
    abortRef.current?.abort();
  }

  async function feedback(msg: MessageDTO, kind: FeedbackKind) {
    if (stream) return;
    await runSSE({ message_id: msg.id, reason: "feedback", feedback: kind }, msg.slot_index);
  }

  async function retry(msg: MessageDTO) {
    if (stream) return;
    await runSSE({ message_id: msg.id, reason: "retry" }, msg.slot_index);
  }

  async function regenConfirmed() {
    if (!regenConfirm) return;
    const { messageId, slot } = regenConfirm;
    setRegenConfirm(null);
    await runSSE({ message_id: messageId, reason: "manual" }, slot);
  }

  async function saveEdit() {
    if (!editing) return;
    const content = editing.text.trim();
    if (!content) return;
    try {
      const res = await jsonFetch<{
        new_message_id: string;
        next_assistant: { id: string; slot: number } | null;
        slot_index: number;
      }>(`/api/messages/${editing.id}`, { method: "PATCH", body: JSON.stringify({ content }) });
      setEditing(null);
      await load();
      setEditAsk({
        nextAssistantId: res.next_assistant?.id ?? null,
        replyToId: res.new_message_id,
        slot: res.next_assistant?.slot ?? res.slot_index + 1,
      });
    } catch (e) {
      setBanner(e instanceof Error ? e.message : "保存失败");
    }
  }

  async function editRegenChoice(regen: boolean) {
    const ctx = editAsk;
    setEditAsk(null);
    if (!ctx || !regen) return;
    if (ctx.nextAssistantId) {
      await runSSE({ message_id: ctx.nextAssistantId, reason: "edit" }, ctx.slot);
    } else {
      await runSSE({ reply_to_message_id: ctx.replyToId, reason: "edit" }, null);
    }
  }

  async function generateNote(fromSlot?: number) {
    if (noteBusy) return;
    setNoteDialog(false);
    setNoteBusy(true);
    try {
      const res = await jsonFetch<{ note: { id: string }; warning?: string | null }>("/api/notes/generate", {
        method: "POST",
        body: JSON.stringify({ conversation_id: convId, from_slot: fromSlot }),
      });
      notifyDone("PAI · 笔记已生成", "长任务完成，点击回到页面查看");
      if (res.warning) pushNotice(res.warning);
      router.push(`/notes/${res.note.id}`);
    } catch (e) {
      setBanner(e instanceof Error ? e.message : "笔记生成失败");
      setNoteBusy(false);
    }
  }

  /** 追加整理（B-1）：把本会话内容合并进已有笔记 */
  async function appendToNote(noteId: string, fromSlot?: number) {
    if (noteBusy || !noteId) return;
    setNoteDialog(false);
    setNoteBusy(true);
    try {
      const r = await jsonFetch<{ unchanged?: boolean; message?: string; note?: { id: string } }>("/api/notes/append", {
        method: "POST",
        body: JSON.stringify({ note_id: noteId, conversation_id: convId, from_slot: fromSlot }),
      });
      if (r.unchanged) {
        pushNotice(r.message ?? "新对话没有值得记录的实质内容，笔记保持不变");
        setNoteBusy(false);
      } else {
        notifyDone("PAI · 追加整理完成", "长任务完成，点击回到页面查看");
        router.push(`/notes/${noteId}`);
      }
    } catch (e) {
      setBanner(e instanceof Error ? e.message : "追加整理失败");
      setNoteBusy(false);
    }
  }

  function openNoteDialog() {
    setNoteRange("");
    setNoteMode("new");
    setMergeTarget("");
    setNoteDialog(true);
    requestNotifyPermission(); // 惰性授权（用户手势内），拒绝则静默降级
    jsonFetch<{ notes: { id: string; title: string }[] }>("/api/notes")
      .then((d) => setExistingNotes(d.notes.map((n) => ({ id: n.id, title: n.title }))))
      .catch(() => setExistingNotes([]));
  }

  if (loading) {
    return (
      <div className="flex h-[70vh] items-center justify-center">
        <Spinner label="加载对话…" />
      </div>
    );
  }
  if (!conv) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center text-text3">
        会话不存在或已被删除。
        <Link href="/" className="ml-2 text-accent hover:underline">
          返回列表
        </Link>
      </div>
    );
  }

  const visible = messages.filter((m) => !(m.role === "user" && m.id.startsWith("local-")) || true);

  return (
    <div className="mx-auto flex h-[calc(100vh-3rem)] max-w-3xl flex-col px-4" onClick={() => personaMenu && setPersonaMenu(false)}>
      {/* 顶部：标题 + 画像状态（画像为空时隐藏，避免「假装懂你」FR-03 ⑥） */}
      <div className="flex items-center justify-between border-b border-border py-3">
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold text-white">{conv.title}</h1>
          <p className="text-xs text-text3">{formatDate(conv.updated_at)} · {messages.length} 条消息</p>
        </div>
        {profileCount > 0 && (
          <Link
            href="/profile"
            className="shrink-0 rounded-full border border-border bg-panel px-3 py-1 text-xs text-text2 transition-colors hover:border-accent hover:text-accent"
            title="查看画像"
          >
            依据 {profileCount} 条画像知识点
          </Link>
        )}
        {/* 人格选择器（融合批次 F1：对话内即时切换，下一条讲解生效） */}
        <div className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => setPersonaMenu((v) => !v)}
            className={`rounded-full border px-3 py-1 text-xs transition-colors ${
              persona === "general"
                ? "border-border bg-panel text-text2 hover:border-purple hover:text-purple"
                : "border-purple/50 bg-purple/10 text-purple"
            }`}
            title="切换导师讲解风格"
          >
            🎭 {personaLabel(persona)} ▾
          </button>
          {personaMenu && (
            <div className="absolute right-0 top-9 z-30 w-64 rounded-xl border border-border bg-panel p-1.5 shadow-2xl">
              {PERSONAS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => void switchPersona(p.id)}
                  className={`block w-full rounded-lg px-3 py-2 text-left transition-colors ${
                    persona === p.id ? "bg-purple/10" : "hover:bg-panel2"
                  }`}
                >
                  <p className={`text-xs font-medium ${persona === p.id ? "text-purple" : "text-text"}`}>
                    {persona === p.id ? "● " : "○ "}
                    {p.label}
                  </p>
                  <p className="mt-0.5 text-[11px] leading-snug text-text3">{p.desc}</p>
                </button>
              ))}
              <p className="px-3 py-1.5 text-[10px] text-text3">全局生效；历史消息的「为什么这么讲」会标注当时所用风格</p>
            </div>
          )}
        </div>
      </div>

      {/* 通知条 */}
      {notices.map((n, i) => (
        <div key={i} className="mt-2 rounded-md border border-teal/30 bg-teal/10 px-3 py-1.5 text-xs text-teal">
          {n}
        </div>
      ))}
      {banner && (
        <div className="mt-2 flex items-center justify-between gap-2 rounded-md border border-danger/40 bg-danger/10 px-3 py-1.5 text-xs text-danger">
          <span className="flex items-center gap-2">
            {banner}
            {banner.includes("未配置模型") && (
              <Link href="/settings" className="underline underline-offset-2 hover:text-white">
                去设置 →
              </Link>
            )}
            {bannerCode === "budget_exceeded" && (
              <button
                onClick={async () => {
                  try {
                    const conv = await jsonFetch<{ id: string }>("/api/conversations", { method: "POST", body: "{}" });
                    router.push(`/chat/${conv.id}`);
                  } catch {
                    router.push("/");
                  }
                }}
                className="underline underline-offset-2 hover:text-white"
              >
                开启新会话 →
              </button>
            )}
          </span>
          <button
            onClick={() => {
              setBanner(null);
              setBannerCode(null);
            }}
            className="shrink-0 text-text3 hover:text-text"
          >
            ×
          </button>
        </div>
      )}

      {/* 消息流 */}
      <div className="flex-1 space-y-4 overflow-y-auto py-4">
        {visible.map((m) =>
          m.role === "user" ? (
            <UserMessage
              key={m.id}
              msg={m}
              highlighted={focusSlot === m.slot_index}
              editing={editing?.id === m.id}
              editValue={editing?.id === m.id ? editing.text : undefined}
              onEditStart={() => setEditing({ id: m.id, text: m.content })}
              onEditChange={(v) => setEditing({ id: m.id, text: v })}
              onEditCancel={() => setEditing(null)}
              onEditSave={saveEdit}
              focusRef={focusSlot === m.slot_index ? focusRef : undefined}
            />
          ) : (
            <AssistantMessage
              key={m.id}
              msg={m}
              stream={stream?.targetSlot === m.slot_index ? stream : null}
              highlighted={focusSlot === m.slot_index}
              disabled={Boolean(stream)}
              onFeedback={(k) => feedback(m, k)}
              onRegen={() => setRegenConfirm({ messageId: m.id, slot: m.slot_index })}
              onRetry={() => retry(m)}
              onShowHistory={() => setHistorySlot(m.slot_index)}
              focusRef={focusSlot === m.slot_index ? focusRef : undefined}
            />
          ),
        )}

        {/* 追加式流式气泡（新提问） */}
        {stream && stream.targetSlot === null && (
          <StreamBubble stream={stream} onStop={stop} />
        )}
        {stream && stream.targetSlot !== null && (
          <div className="text-center text-xs text-text3">正在重新生成第 {stream.targetSlot + 1} 条回答…（旧版可在历史版本中查看）</div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* 输入区 */}
      <div className="border-t border-border py-3">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="问一个你不懂的概念，例如：什么是特征值？"
            rows={2}
            className="flex-1 resize-none rounded-lg border border-border bg-panel px-3.5 py-2.5 text-sm text-text placeholder:text-text3 focus:border-accent focus:outline-none"
          />
          <div className="flex flex-col gap-2">
            {stream ? (
              <button
                onClick={stop}
                className="rounded-lg border border-danger/50 bg-danger/10 px-4 py-2 text-sm text-danger hover:bg-danger/20"
              >
                停止
              </button>
            ) : (
              <button
                onClick={send}
                disabled={!input.trim()}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                发送
              </button>
            )}
          </div>
        </div>
        {/* 存为笔记（FR-05）：独立醒目入口 */}
        <div className="mt-2.5 flex items-center justify-between gap-3">
          <button
            onClick={openNoteDialog}
            disabled={noteBusy || messages.filter((m) => m.role === "user").length === 0}
            className="flex items-center gap-1.5 rounded-lg border border-accent/60 bg-accent/10 px-4 py-1.5 text-sm font-medium text-accent transition-colors hover:bg-accent/20 disabled:opacity-40"
            title="把本对话（或其中一段）整理为可导出的结构化讲义"
          >
            📝 {noteBusy ? "整理中，约需 10–30 秒…" : "存为笔记"}
          </button>
          <p className="text-[11px] text-text3">Enter 发送 · Shift+Enter 换行</p>
        </div>
      </div>

      {/* 存为笔记：新建 / 合并进已有笔记（B-1 追加整理）+ 范围选择 */}
      <ConfirmDialog
        open={noteDialog}
        title="存为笔记"
        message={
          noteMode === "new"
            ? "AI 将把对话整理为六段式结构化讲义（总结 / 核心概念 / 例子 / 误区 / 延伸问题），核心概念可溯源回对话原文。生成后打开笔记，划选任意术语还可获得即时解答。"
            : "AI 将把本对话中有价值的新内容合并进你选择的笔记（重复去重、矛盾以新对话为准），版本 +1，旧版本可回退。"
        }
        confirmText={noteMode === "new" ? "生成笔记" : "合并进笔记"}
        onConfirm={() => {
          const fromSlot = noteRange === "" ? undefined : Number(noteRange);
          if (noteMode === "new") void generateNote(fromSlot);
          else void appendToNote(mergeTarget, fromSlot);
        }}
        onCancel={() => setNoteDialog(false)}
      >
        {/* 模式切换 */}
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => setNoteMode("new")}
            className={`flex-1 rounded-lg border px-3 py-1.5 text-xs transition-colors ${
              noteMode === "new" ? "border-accent bg-accent/15 text-accent" : "border-border text-text2 hover:text-text"
            }`}
          >
            新建笔记
          </button>
          <button
            onClick={() => setNoteMode("merge")}
            disabled={existingNotes.length === 0}
            className={`flex-1 rounded-lg border px-3 py-1.5 text-xs transition-colors disabled:opacity-40 ${
              noteMode === "merge" ? "border-accent bg-accent/15 text-accent" : "border-border text-text2 hover:text-text"
            }`}
            title={existingNotes.length === 0 ? "还没有已有笔记" : undefined}
          >
            合并进已有笔记
          </button>
        </div>

        {noteMode === "merge" && (
          <div className="mt-3">
            <label className="mb-1.5 block text-xs text-text2">目标笔记</label>
            <select
              value={mergeTarget}
              onChange={(e) => setMergeTarget(e.target.value)}
              className="w-full rounded-md border border-border bg-panel2 px-3 py-2 text-sm text-text focus:border-accent focus:outline-none"
            >
              <option value="">选择要合并进的笔记…</option>
              {existingNotes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.title.slice(0, 36)}
                </option>
              ))}
            </select>
          </div>
        )}

        <label className="mb-1.5 mt-3 block text-xs text-text2">整理范围</label>
        <select
          value={noteRange}
          onChange={(e) => setNoteRange(e.target.value)}
          className="w-full rounded-md border border-border bg-panel2 px-3 py-2 text-sm text-text focus:border-accent focus:outline-none"
        >
          <option value="">整个会话</option>
          {messages
            .filter((m) => m.role === "user")
            .map((m) => (
              <option key={m.id} value={m.slot_index}>
                从「{m.content.slice(0, 18)}{m.content.length > 18 ? "…" : ""}」开始
              </option>
            ))}
        </select>
        <p className="mt-1.5 text-[11px] text-text3">
          {noteMode === "merge"
            ? "同一篇笔记只整合同一会话一次；合并后可在笔记页查看版本历史。"
            : "选择某条提问后，将只整理该提问及之后的内容（生成约需 10–30 秒）。"}
        </p>
      </ConfirmDialog>

      {/* 确认弹窗们 */}
      <ConfirmDialog
        open={Boolean(regenConfirm)}
        title="重新生成回答？"
        message="将生成新版本回答，当前版本会保留在「历史版本」中可随时回看。"
        confirmText="重新生成"
        onConfirm={regenConfirmed}
        onCancel={() => setRegenConfirm(null)}
      />
      <ConfirmDialog
        open={Boolean(editAsk)}
        title="已保存修改"
        message="是否让 AI 基于修改后的内容重新回答？后续旧回答将标记为「基于修改前内容」。"
        confirmText="重新回答"
        onConfirm={() => editRegenChoice(true)}
        onCancel={() => editRegenChoice(false)}
      />
      {historySlot !== null && (
        <VersionHistoryModal convId={convId} slot={historySlot} onClose={() => setHistorySlot(null)} />
      )}
    </div>
  );
}

function evToMeta(ev: Extract<SSEEvent, { type: "meta" }>): MessageMeta {
  return {
    depth: ev.depth,
    concept_name: ev.concept_name,
    domain: ev.domain,
    profile_hit: ev.profile_hit,
    used_entries: ev.used_entries,
    missing_prereqs: ev.missing_prereqs,
    evidence: ev.evidence,
    feedback: ev.feedback,
    persona: ev.persona,
  };
}

/* ---------------- 子组件 ---------------- */

function UserMessage({
  msg,
  highlighted,
  editing,
  editValue,
  onEditStart,
  onEditChange,
  onEditCancel,
  onEditSave,
  focusRef,
}: {
  msg: MessageDTO;
  highlighted: boolean;
  editing: boolean;
  editValue?: string;
  onEditStart: () => void;
  onEditChange: (v: string) => void;
  onEditCancel: () => void;
  onEditSave: () => void;
  focusRef?: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div ref={focusRef} className={`group flex flex-col items-end ${highlighted ? "rounded-lg bg-accent/10 px-2 py-1 ring-1 ring-accent/50" : ""}`}>
      {editing ? (
        <div className="w-full rounded-lg border border-accent/50 bg-panel p-2">
          <textarea
            value={editValue ?? ""}
            onChange={(e) => onEditChange(e.target.value)}
            rows={3}
            className="w-full resize-none bg-transparent text-sm text-text focus:outline-none"
            autoFocus
          />
          <div className="mt-2 flex justify-end gap-2">
            <button onClick={onEditCancel} className="rounded border border-border px-3 py-1 text-xs text-text2 hover:bg-panel2">
              取消
            </button>
            <button onClick={onEditSave} className="rounded bg-accent px-3 py-1 text-xs font-medium text-bg">
              保存并重答
            </button>
          </div>
        </div>
      ) : (
        <div className="max-w-[85%] rounded-lg bg-accent/15 px-3.5 py-2 text-sm leading-relaxed text-text">
          {msg.content}
        </div>
      )}
      {!editing && (
        <div className="mt-1 flex gap-2 text-[11px] text-text3 opacity-0 transition-opacity group-hover:opacity-100">
          {msg.edited_from && <span className="text-warn">已编辑</span>}
          <button onClick={onEditStart} className="hover:text-accent">
            编辑
          </button>
        </div>
      )}
    </div>
  );
}

function AssistantMessage({
  msg,
  stream,
  highlighted,
  disabled,
  onFeedback,
  onRegen,
  onRetry,
  onShowHistory,
  focusRef,
}: {
  msg: MessageDTO;
  stream: StreamState | null;
  highlighted: boolean;
  disabled: boolean;
  onFeedback: (k: FeedbackKind) => void;
  onRegen: () => void;
  onRetry: () => void;
  onShowHistory: () => void;
  focusRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const [whyOpen, setWhyOpen] = useState(false);
  const [staleOpen, setStaleOpen] = useState(false);

  // 被流式替换显示
  if (stream) {
    return <StreamBubble stream={stream} onStop={() => {}} />;
  }

  if (msg.status === "stale" && !staleOpen) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-dashed border-border bg-panel/40 px-3.5 py-2 text-xs text-text3">
        <span>该回答基于修改前的提问内容</span>
        <button onClick={() => setStaleOpen(true)} className="text-text2 hover:text-text">
          展开
        </button>
        <button onClick={onRegen} className="text-accent hover:underline">
          重新生成
        </button>
      </div>
    );
  }

  const meta = msg.meta;
  return (
    <div
      ref={focusRef}
      className={`group rounded-lg border border-border bg-panel px-4 py-3 ${highlighted ? "ring-1 ring-accent/60" : ""}`}
    >
      <div className="mb-1.5 flex items-center gap-2 text-[11px]">
        {meta && (
          <span className="rounded bg-purple/15 px-1.5 py-0.5 text-purple">{DEPTH_LABELS[meta.depth]}</span>
        )}
        {meta?.persona && meta.persona !== "general" && (
          <span className="rounded bg-teal/15 px-1.5 py-0.5 text-teal">
            🎭 {personaLabel(meta.persona)}
            {meta.persona === "socratic" && meta.socratic_state === "guiding" && " · 引导中"}
            {meta.persona === "socratic" && meta.socratic_state === "done" && " · 已复盘"}
          </span>
        )}
        {meta?.concept_name && <span className="text-text3">概念：{meta.concept_name}</span>}
        {meta?.has_diagram && <span className="text-text3">📐 图示</span>}
        {msg.status === "incomplete" && <span className="text-warn">生成中断</span>}
        {msg.status === "stale" && staleOpen && <span className="text-text3">（基于修改前内容）</span>}
      </div>

      <Markdown>{msg.content || "（空）"}</Markdown>

      {msg.status === "incomplete" && (
        <div className="mt-2 flex items-center gap-3 text-xs">
          <span className="text-warn">已生成内容已保留，但未完成</span>
          <button onClick={onRetry} disabled={disabled} className="rounded border border-warn/50 px-2.5 py-1 text-warn hover:bg-warn/10 disabled:opacity-40">
            重试生成
          </button>
        </div>
      )}

      {/* 反馈条（FR-03 ④：固定三入口） */}
      {msg.content && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-2 text-xs">
          {FEEDBACKS.map((f) => (
            <button
              key={f.kind}
              onClick={() => onFeedback(f.kind)}
              disabled={disabled}
              className="rounded border border-border px-2.5 py-1 text-text2 transition-colors hover:border-accent hover:text-accent disabled:opacity-40"
            >
              {f.label}
            </button>
          ))}
          <span className="mx-1 h-3 w-px bg-border" />
          <button onClick={onRegen} disabled={disabled} className="rounded px-2 py-1 text-text3 hover:text-text disabled:opacity-40">
            重新生成
          </button>
          {msg.has_history && (
            <button onClick={onShowHistory} className="rounded px-2 py-1 text-text3 hover:text-text">
              历史版本
            </button>
          )}
          {meta && (
            <button onClick={() => setWhyOpen((v) => !v)} className="rounded px-2 py-1 text-text3 hover:text-teal">
              {whyOpen ? "收起解释" : "为什么这么讲"}
            </button>
          )}
        </div>
      )}

      {whyOpen && meta && <WhyPanel meta={meta} />}
    </div>
  );
}

function StreamBubble({ stream, onStop }: { stream: StreamState; onStop: () => void }) {
  return (
    <div className="rounded-lg border border-accent/40 bg-panel px-4 py-3">
      {stream.meta && (
        <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[11px]">
          <span className="rounded bg-purple/15 px-1.5 py-0.5 text-purple">{DEPTH_LABELS[stream.meta.depth]}</span>
          {stream.meta.persona && stream.meta.persona !== "general" && (
            <span className="rounded bg-teal/15 px-1.5 py-0.5 text-teal">🎭 {personaLabel(stream.meta.persona)}</span>
          )}
          {stream.meta.concept_name && <span className="text-text3">概念：{stream.meta.concept_name}</span>}
          <button onClick={onStop} className="ml-auto text-xs text-danger hover:underline">
            停止生成
          </button>
        </div>
      )}
      {stream.text ? (
        <div className="stream-cursor">
          <Markdown>{stream.text}</Markdown>
        </div>
      ) : (
        <Spinner label="正在思考…" />
      )}
    </div>
  );
}

/** 可解释面板（FR-03 ⑤） */
const PERSONA_LABELS: Record<string, string> = {
  socratic: "苏格拉底式",
  coach: "教练式",
  minimal: "极简式",
};

function WhyPanel({ meta }: { meta: MessageMeta }) {
  return (
    <div className="mt-2.5 space-y-2 rounded-lg bg-panel2/60 p-3 text-xs leading-relaxed text-text2">
      {meta.persona && meta.persona !== "general" && (
        <p>
          <span className="text-purple">讲解风格：</span>
          {PERSONA_LABELS[meta.persona] ?? meta.persona}
        </p>
      )}
      <p>
        <span className="text-teal">判档依据：</span>
        {meta.profile_hit && meta.used_entries.length > 0 ? (
          <>画像命中 {meta.used_entries.length} 条知识点——</>
        ) : (
          <>画像中无该概念的记录，使用默认 L1 档，且未声称「根据你的掌握情况」。 </>
        )}
        {meta.used_entries.map((e) => (
          <span key={e.name} className="ml-1 inline-block rounded bg-panel px-1.5 py-0.5">
            {e.name} {e.mastery.toFixed(2)}
          </span>
        ))}
      </p>
      {meta.missing_prereqs.length > 0 && (
        <p>
          <span className="text-warn">先补基础：</span>
          {meta.missing_prereqs.map((p) => `${p.name}（${p.mastery.toFixed(2)}）`).join("、")}
        </p>
      )}
      {meta.evidence.length > 0 && (
        <div>
          <span className="text-teal">历史证据：</span>
          <ul className="mt-1 space-y-1">
            {meta.evidence.map((e, i) => (
              <li key={i} className="rounded bg-panel px-2 py-1">
                <span className="text-text3">对话第 {e.slot} 条：</span>“{e.excerpt}…”
              </li>
            ))}
          </ul>
        </div>
      )}
      {meta.feedback && (
        <p className="text-text3">
          本版由「{meta.feedback === "too_verbose" ? "太啰嗦" : meta.feedback === "more_detail" ? "再详细些" : "换种讲法"}」反馈触发重新生成。
        </p>
      )}
    </div>
  );
}

function VersionHistoryModal({ convId, slot, onClose }: { convId: string; slot: number; onClose: () => void }) {
  const [versions, setVersions] = useState<MessageDTO[] | null>(null);
  useEffect(() => {
    jsonFetch<MessageDTO[]>(`/api/conversations/${convId}/messages?slot=${slot}`).then(setVersions).catch(() => setVersions([]));
  }, [convId, slot]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-xl border border-border bg-panel p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold text-white">第 {slot + 1} 条消息 · 历史版本</h3>
          <button onClick={onClose} className="text-text3 hover:text-text">
            ×
          </button>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto pr-1">
          {!versions && <Spinner label="加载版本…" />}
          {versions?.map((v) => (
            <div key={v.id} className={`rounded-lg border p-3 text-sm ${v.revision === versions[0].revision ? "border-accent/50" : "border-border"}`}>
              <div className="mb-1.5 flex items-center gap-2 text-[11px] text-text3">
                <span className="rounded bg-panel2 px-1.5 py-0.5">版本 {v.revision}</span>
                <span>{new Date(v.created_at).toLocaleString("zh-CN")}</span>
                {v.revision === versions[0].revision && <span className="text-accent">当前</span>}
                {v.meta?.feedback && <span className="text-purple">由「{v.meta.feedback}」反馈产生</span>}
                {v.edited_from !== null && <span className="text-warn">编辑前内容</span>}
              </div>
              <div className="max-h-56 overflow-y-auto text-text2">
                <Markdown>{v.content || "（空）"}</Markdown>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
