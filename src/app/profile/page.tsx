"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { ProfileEntryDTO, ProfileLogDTO } from "@/lib/types";
import { formatDate, jsonFetch } from "@/lib/client/api";
import { EmptyState } from "@/components/common/EmptyState";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";

const SIGNAL_LABELS: Record<string, string> = {
  ask_new: "首次提问",
  ask_touch: "提问接触",
  feedback_too_verbose: "反馈·太啰嗦",
  feedback_more_detail: "反馈·再详细些",
  user_edit: "手动调整",
  user_delete: "手动删除",
  decay: "90 天衰减",
  note_touch: "笔记提及",
  protected_skip: "保护期拦截",
  evidence_lost_delete: "证据丢失移除",
};

function masteryColor(m: number): string {
  if (m >= 0.7) return "bg-accent2";
  if (m >= 0.4) return "bg-warn";
  return "bg-danger";
}

/** 画像页（FR-04）：看懂「AI 认为我会什么」，30 秒内改掉错的 */
export default function ProfilePage() {
  const [entries, setEntries] = useState<ProfileEntryDTO[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ProfileEntryDTO | null>(null);
  const [logs, setLogs] = useState<Record<string, ProfileLogDTO[]>>({});

  const load = useCallback(() => {
    jsonFetch<ProfileEntryDTO[]>("/api/profile").then(setEntries).catch(() => setEntries([]));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const grouped = useMemo(() => {
    const map = new Map<string, ProfileEntryDTO[]>();
    for (const e of entries ?? []) {
      const list = map.get(e.domain) ?? [];
      list.push(e);
      map.set(e.domain, list);
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [entries]);

  async function adjust(entry: ProfileEntryDTO, delta: number) {
    const next = Math.round((entry.mastery + delta) * 100) / 100;
    if (next < 0.1 || next > 0.95) return;
    try {
      await jsonFetch(`/api/profile/${entry.id}`, { method: "PATCH", body: JSON.stringify({ mastery: next }) });
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "调整失败");
    }
  }

  async function loadLogs(entryId: string) {
    if (logs[entryId]) return;
    const l = await jsonFetch<ProfileLogDTO[]>(`/api/profile/${entryId}/logs`).catch(() => []);
    setLogs((prev) => ({ ...prev, [entryId]: l }));
  }

  async function confirmDelete() {
    if (!deleting) return;
    await jsonFetch(`/api/profile/${deleting.id}`, { method: "DELETE" }).catch(() => {});
    setDeleting(null);
    setExpanded(null);
    load();
  }

  if (entries === null) {
    return <div className="py-16 text-center text-sm text-text3">加载中…</div>;
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">我的知识画像</h1>
        <p className="mt-0.5 text-sm text-text3">
          AI 对「你已经会什么」的认知都在这里——发现不对的，直接改，30 天内系统不会覆盖你的判断
        </p>
      </div>

      {entries.length === 0 ? (
        <EmptyState
          title="画像还是空的"
          hint="去对话页问几个概念，AI 会开始记录你的学习轨迹"
          action={
            <Link href="/" className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg hover:opacity-90">
              开始学习
            </Link>
          }
        />
      ) : (
        <>
          <div className="mb-4 flex items-center gap-3 text-xs text-text3">
            <span>共 {entries.length} 个知识点</span>
            <span>·</span>
            <span>{grouped.length} 个领域</span>
            <span>·</span>
            <span>掌握度颜色：红 &lt;0.4 · 黄 0.4–0.7 · 绿 ≥0.7</span>
          </div>
          <div className="space-y-6">
            {grouped.map(([domain, list]) => (
              <section key={domain}>
                <h2 className="mb-2.5 text-sm font-semibold text-text2">
                  {domain}
                  <span className="ml-2 text-xs font-normal text-text3">{list.length}</span>
                </h2>
                <div className="space-y-2">
                  {list.map((e) => {
                    const open = expanded === e.id;
                    const protectedLeft = e.protected_until && e.protected_until > new Date().toISOString()
                      ? Math.ceil((new Date(e.protected_until).getTime() - Date.now()) / 86400000)
                      : 0;
                    return (
                      <div key={e.id} className={`rounded-xl border bg-panel transition-colors ${open ? "border-accent/50" : "border-border"}`}>
                        <button
                          className="flex w-full items-center gap-3 px-4 py-3 text-left"
                          onClick={() => {
                            const next = open ? null : e.id;
                            setExpanded(next);
                            if (next) loadLogs(next);
                          }}
                        >
                          <span className="min-w-0 flex-1 truncate text-sm font-medium text-text">{e.concept_name}</span>
                          {e.source_type === "user" && (
                            <span className="shrink-0 rounded border border-teal/40 px-1.5 py-0.5 text-[11px] text-teal">
                              由你设定{protectedLeft > 0 ? ` · 剩 ${protectedLeft} 天` : ""}
                            </span>
                          )}
                          <span className="flex w-28 shrink-0 items-center gap-2">
                            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-panel2">
                              <span
                                className={`block h-full rounded-full ${masteryColor(e.mastery)}`}
                                style={{ width: `${Math.round(e.mastery * 100)}%` }}
                              />
                            </span>
                            <span className="text-xs tabular-nums text-text2">{e.mastery.toFixed(2)}</span>
                          </span>
                          <span className="hidden shrink-0 text-xs text-text3 sm:inline">{e.evidence_refs.length} 证据</span>
                          <span className="hidden shrink-0 text-xs text-text3 md:inline">{formatDate(e.last_touched_at)}</span>
                          <span className="shrink-0 text-xs text-text3">{open ? "▲" : "▼"}</span>
                        </button>

                        {open && (
                          <div className="space-y-4 border-t border-border/60 px-4 py-3.5">
                            {/* 掌握度调整（AC-04-1） */}
                            <div className="flex items-center gap-3">
                              <span className="text-xs text-text3">掌握度</span>
                              <button
                                onClick={() => adjust(e, -0.1)}
                                className="h-7 w-7 rounded-md border border-border text-sm text-text2 hover:border-accent hover:text-accent"
                              >
                                −
                              </button>
                              <span className="w-10 text-center text-sm font-semibold tabular-nums text-white">{e.mastery.toFixed(2)}</span>
                              <button
                                onClick={() => adjust(e, 0.1)}
                                className="h-7 w-7 rounded-md border border-border text-sm text-text2 hover:border-accent hover:text-accent"
                              >
                                +
                              </button>
                              <span className="text-xs text-text3">步长 0.1，范围 0.1–0.95；设定后 30 天内系统推断不覆盖</span>
                              <button
                                onClick={() => setDeleting(e)}
                                className="ml-auto rounded-md border border-border px-2.5 py-1 text-xs text-text3 hover:border-danger hover:text-danger"
                              >
                                删除条目
                              </button>
                            </div>

                            {/* 证据（AC：点击跳转到对应消息并高亮） */}
                            <div>
                              <p className="mb-1.5 text-xs text-text3">证据来源（{e.evidence_refs.length}）</p>
                              {e.evidence_refs.length === 0 ? (
                                <p className="text-xs text-text3">（暂无证据）</p>
                              ) : (
                                <div className="flex flex-wrap gap-2">
                                  {e.evidence_refs.map((r, i) => (
                                    <Link
                                      key={i}
                                      href={`/chat/${r.conversation_id}?slot=${r.slot}`}
                                      className="rounded-md border border-border bg-panel2 px-2.5 py-1 text-xs text-text2 transition-colors hover:border-accent hover:text-accent"
                                    >
                                      对话第 {r.slot + 1} 条 ↗
                                    </Link>
                                  ))}
                                </div>
                              )}
                            </div>

                            {/* 变更历史（AC-08-2：时间、原值、新值、信号类型） */}
                            <div>
                              <p className="mb-1.5 text-xs text-text3">变更历史</p>
                              <div className="max-h-44 space-y-1 overflow-y-auto pr-1">
                                {(logs[e.id] ?? []).map((l) => (
                                  <div key={l.id} className="flex items-center gap-2 rounded bg-panel2/60 px-2.5 py-1 text-xs text-text2">
                                    <span className="text-text3">{new Date(l.created_at).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                                    <span className="rounded bg-panel px-1.5 py-0.5 text-[11px] text-teal">{SIGNAL_LABELS[l.signal_type] ?? l.signal_type}</span>
                                    {l.old_value !== null && (
                                      <span className="tabular-nums">
                                        {l.old_value.toFixed(2)} → {l.new_value?.toFixed(2) ?? "删除"}
                                      </span>
                                    )}
                                    {l.old_value === null && l.new_value !== null && <span className="tabular-nums">初始化 {l.new_value.toFixed(2)}</span>}
                                  </div>
                                ))}
                                {(logs[e.id] ?? []).length === 0 && <p className="text-xs text-text3">（无记录）</p>}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </>
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        title="删除画像条目？"
        message={`删除「${deleting?.concept_name}」后，再次提问该知识点时 AI 将按「无记录」处理（默认 L1 档），不会残留旧判定。`}
        confirmText="删除"
        danger
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
