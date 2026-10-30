"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { ConversationDTO, StatsDTO } from "@/lib/types";
import { formatDate, jsonFetch } from "@/lib/client/api";
import { EmptyState } from "@/components/common/EmptyState";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";

interface Insight {
  icon: string;
  title: string;
  detail: string;
  href: string;
}

/** 会话列表（入口页，AC-01-1 空状态引导） */
export default function HomePage() {
  return (
    <Suspense fallback={<div className="flex h-[60vh] items-center justify-center text-sm text-text3">加载中…</div>}>
      <HomePageInner />
    </Suspense>
  );
}

function HomePageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [convs, setConvs] = useState<ConversationDTO[] | null>(null);
  const [stats, setStats] = useState<StatsDTO | null>(null);
  const [insights, setInsights] = useState<Insight[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<ConversationDTO | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleting, setDeleting] = useState<ConversationDTO | null>(null);
  const [noteBusyId, setNoteBusyId] = useState<string | null>(null);
  const askHandled = useRef(false);

  // 洞察卡「去讲解」链接：/?ask=X → 自动开新会话并预填问题
  useEffect(() => {
    const ask = searchParams.get("ask");
    if (!ask || askHandled.current) return;
    askHandled.current = true;
    void (async () => {
      try {
        const conv = await jsonFetch<{ id: string }>("/api/conversations", { method: "POST", body: "{}" });
        router.push(`/chat/${conv.id}?ask=${encodeURIComponent(ask)}`);
      } catch {
        /* 失败留在首页 */
      }
    })();
  }, [searchParams, router]);

  // 主动学习洞察（融合批次 F1 阶段 4）
  useEffect(() => {
    jsonFetch<{ insights: Insight[] }>("/api/insights")
      .then((d) => setInsights(d.insights))
      .catch(() => setInsights([]));
  }, []);

  /** 从会话列表直接生成笔记（免进对话页） */
  async function saveNote(c: ConversationDTO) {
    setNoteBusyId(c.id);
    try {
      const res = await jsonFetch<{ note: { id: string } }>("/api/notes/generate", {
        method: "POST",
        body: JSON.stringify({ conversation_id: c.id }),
      });
      router.push(`/notes/${res.note.id}`);
    } catch (e) {
      alert(e instanceof Error ? e.message : "笔记生成失败");
      setNoteBusyId(null);
    }
  }

  const load = useCallback(async () => {
    try {
      const [c, s] = await Promise.all([
        jsonFetch<ConversationDTO[]>("/api/conversations"),
        jsonFetch<StatsDTO>("/api/stats"),
      ]);
      setConvs(c);
      setStats(s);
    } catch {
      setConvs([]);
    }
  }, []);

  useEffect(() => {
    // 挂载加载：setState 走 Promise 回调（react-hooks/set-state-in-effect 要求）
    Promise.all([jsonFetch<ConversationDTO[]>("/api/conversations"), jsonFetch<StatsDTO>("/api/stats")])
      .then(([c, s]) => {
        setConvs(c);
        setStats(s);
      })
      .catch(() => setConvs([]));
  }, []);

  async function createConversation() {
    setCreating(true);
    try {
      const conv = await jsonFetch<{ id: string }>("/api/conversations", { method: "POST", body: "{}" });
      router.push(`/chat/${conv.id}`);
    } finally {
      setCreating(false);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    await jsonFetch(`/api/conversations/${deleting.id}`, { method: "DELETE" }).catch(() => {});
    setDeleting(null);
    load();
  }

  async function confirmRename() {
    if (!renaming || !renameValue.trim()) return;
    await jsonFetch(`/api/conversations/${renaming.id}`, {
      method: "PATCH",
      body: JSON.stringify({ title: renameValue.trim() }),
    }).catch(() => {});
    setRenaming(null);
    load();
  }

  const newBtn = (
    <button
      onClick={createConversation}
      disabled={creating}
      className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-40"
    >
      + 开始新的学习
    </button>
  );

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">最近学习</h1>
          <p className="mt-0.5 text-sm text-text3">AI 会记住你学过什么，越用越懂你</p>
        </div>
        {newBtn}
      </div>

      {stats && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="本周闭环" value={String(stats.week_closures)} hint="完成「提问→笔记」的会话" />
          <StatCard label="画像知识点" value={String(stats.profile_entries)} />
          <StatCard label="笔记" value={String(stats.note_count)} />
          <StatCard
            label="累计成本"
            value={stats.cost_estimate !== null ? `¥${stats.cost_estimate.toFixed(2)}` : String(stats.token_in + stats.token_out)}
            hint={stats.cost_estimate !== null ? `单会话均 ¥${stats.avg_session_cost!.toFixed(2)}` : "tokens（未配单价）"}
          />
        </div>
      )}

      {/* 今日学习建议（融合批次 F1 阶段 4：数据驱动洞察卡，无推送） */}
      {insights !== null && insights.length > 0 && (
        <div className="mb-6 rounded-xl border border-purple/30 bg-purple/5 p-4">
          <p className="mb-2.5 text-xs font-medium text-purple">💡 今日学习建议</p>
          <div className="space-y-2">
            {insights.map((ins) => (
              <Link
                key={ins.title}
                href={ins.href}
                className="flex items-start gap-2.5 rounded-lg bg-panel px-3 py-2.5 transition-colors hover:bg-panel2"
              >
                <span className="text-base leading-5">{ins.icon}</span>
                <span className="min-w-0">
                  <span className="block text-sm text-text">{ins.title}</span>
                  <span className="block text-xs text-text3">{ins.detail}</span>
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {convs === null ? (
        <div className="py-16 text-center text-sm text-text3">加载中…</div>
      ) : convs.length === 0 ? (
        <EmptyState
          title="还没有学习记录"
          hint="问出第一个你不懂的概念，AI 会开始为你建立知识画像"
          action={newBtn}
        />
      ) : (
        <div className="space-y-2.5">
          {convs.map((c, i) => (
            <div
              key={c.id}
              style={{ animationDelay: `${Math.min(i * 45, 320)}ms` }}
              className="card-lift card-enter group flex items-center gap-3 rounded-xl border border-border bg-panel px-4 py-3"
            >
              <Link href={`/chat/${c.id}`} className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-text group-hover:text-white">{c.title}</p>
                <p className="mt-0.5 truncate text-xs text-text3">
                  {c.message_count} 条消息 · {c.preview || "（暂无内容）"}
                </p>
              </Link>
              <span className="shrink-0 text-xs text-text3">{formatDate(c.updated_at)}</span>
              <button
                onClick={() => saveNote(c)}
                disabled={noteBusyId !== null}
                className="shrink-0 rounded p-1 text-text3 opacity-0 hover:text-accent group-hover:opacity-100 disabled:opacity-30"
                title={noteBusyId === c.id ? "整理中，约需 10–30 秒…" : "存为笔记"}
              >
                {noteBusyId === c.id ? "⏳" : "📝"}
              </button>
              <button
                onClick={() => {
                  setRenaming(c);
                  setRenameValue(c.title);
                }}
                className="shrink-0 rounded p-1 text-text3 opacity-0 hover:text-accent group-hover:opacity-100"
                title="重命名"
              >
                ✎
              </button>
              <button
                onClick={() => setDeleting(c)}
                className="shrink-0 rounded p-1 text-text3 opacity-0 hover:text-danger group-hover:opacity-100"
                title="删除"
              >
                🗑
              </button>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        title="删除会话？"
        message="会话的消息将被彻底删除；已生成的笔记会保留正文并标记「来源已删除」；画像中仅来自该会话的证据会被移除。"
        confirmText="删除"
        danger
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
      <ConfirmDialog
        open={Boolean(renaming)}
        title="重命名会话"
        confirmText="保存"
        onConfirm={confirmRename}
        onCancel={() => setRenaming(null)}
      >
        <input
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          className="mt-3 w-full rounded-md border border-border bg-panel2 px-3 py-2 text-sm text-text focus:border-accent focus:outline-none"
          autoFocus
        />
      </ConfirmDialog>
    </div>
  );
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-panel px-3.5 py-2.5">
      <p className="text-lg font-semibold text-white">{value}</p>
      <p className="text-xs text-text3">{label}</p>
      {hint && <p className="text-[11px] text-text3">{hint}</p>}
    </div>
  );
}
