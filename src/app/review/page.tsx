"use client";

import { useCallback, useEffect, Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { NoteDTO } from "@/lib/types";
import { formatDate, jsonFetch } from "@/lib/client/api";
import { Spinner } from "@/components/common/EmptyState";

interface ReviewCard {
  front: string;
  back: string;
  anchorId: string | null;
  source: "concept" | "glossary";
}

interface QueueItem {
  note: NoteDTO;
  cardCount: number;
  lastReview: string | null;
  minMastery: number | null;
}

type Phase =
  | { kind: "queue" }
  | { kind: "session"; noteId: string; title: string; cards: ReviewCard[]; index: number; revealed: boolean; known: number; unknown: number }
  | { kind: "done"; title: string; known: number; unknown: number };

export default function ReviewPage() {
  return (
    <Suspense fallback={<div className="flex h-[60vh] items-center justify-center"><Spinner /></div>}>
      <ReviewPageInner />
    </Suspense>
  );
}

function ReviewPageInner() {
  const searchParams = useSearchParams();
  const preselect = searchParams.get("note");
  const [phase, setPhase] = useState<Phase>({ kind: "queue" });
  const [queue, setQueue] = useState<QueueItem[] | null>(null);

  const loadQueue = useCallback(() => {
    jsonFetch<{ queue: QueueItem[] }>("/api/review/queue").then((d) => setQueue(d.queue)).catch(() => setQueue([]));
  }, []);

  const startSession = useCallback(async (noteId: string, jump = false) => {
    try {
      const d = await jsonFetch<{ cards: ReviewCard[]; title: string }>(`/api/notes/${noteId}/cards`);
      if (d.cards.length === 0) {
        alert("这篇笔记没有可抽取的卡片（需要「核心概念」或「术语表」章节）");
        return;
      }
      setPhase({ kind: "session", noteId, title: d.title, cards: d.cards, index: 0, revealed: false, known: 0, unknown: 0 });
    } catch (e) {
      if (!jump) alert(e instanceof Error ? e.message : "加载失败");
    }
  }, []);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  // 从笔记页带 ?note= 进入：直接开复习（延后微任务执行，避免 effect 内同步 setState）
  useEffect(() => {
    if (preselect) setTimeout(() => void startSession(preselect, true), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselect]);

  async function grade(concept: string, g: "known" | "unknown") {
    if (phase.kind !== "session") return;
    try {
      await jsonFetch("/api/review/grade", {
        method: "POST",
        body: JSON.stringify({ note_id: phase.noteId, concept_name: concept, grade: g }),
      });
    } catch {
      /* 单卡评分失败不中断会话 */
    }
    const known = phase.known + (g === "known" ? 1 : 0);
    const unknown = phase.unknown + (g === "unknown" ? 1 : 0);
    if (phase.index + 1 >= phase.cards.length) {
      setPhase({ kind: "done", title: phase.title, known, unknown });
      loadQueue();
    } else {
      setPhase({ ...phase, index: phase.index + 1, revealed: false, known, unknown });
    }
  }

  function exportAnki(noteId: string, title: string) {
    jsonFetch<{ cards: ReviewCard[] }>(`/api/notes/${noteId}/cards`)
      .then((d) => {
        const tsv = d.cards.map((c) => `${c.front.replace(/\t/g, " ")}\t${c.back.replace(/\t/g, " ")}`).join("\n");
        const blob = new Blob([tsv], { type: "text/tab-separated-values;charset=utf-8" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `${title.replace(/[\\/:*?"<>|]/g, "")}-anki.tsv`;
        a.click();
        URL.revokeObjectURL(a.href);
      })
      .catch(() => alert("导出失败"));
  }

  /* ---------- 卡片会话 ---------- */
  if (phase.kind === "session") {
    const card = phase.cards[phase.index];
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <div className="mb-4 flex items-center justify-between text-xs text-text3">
          <span className="truncate">{phase.title}</span>
          <span>
            {phase.index + 1} / {phase.cards.length} · ✓{phase.known} ✗{phase.unknown}
          </span>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-panel2">
          <div className="h-full bg-accent transition-all" style={{ width: `${(phase.index / phase.cards.length) * 100}%` }} />
        </div>

        <div className="mt-8 rounded-2xl border border-border bg-panel p-8 text-center">
          <p className="text-xs text-text3">{card.source === "concept" ? "核心概念" : "术语表"}</p>
          <p className="mt-3 text-2xl font-bold text-white">{card.front}</p>
          {phase.revealed ? (
            <div className="mt-6 border-t border-border/60 pt-5 text-left">
              <p className="text-sm leading-relaxed text-text">{card.back}</p>
            </div>
          ) : (
            <button
              onClick={() => setPhase({ ...phase, revealed: true })}
              className="mt-8 rounded-lg bg-accent px-6 py-2.5 text-sm font-medium text-bg hover:opacity-90"
            >
              翻面看答案
            </button>
          )}
        </div>

        {phase.revealed && (
          <div className="mt-5 flex gap-3">
            <button
              onClick={() => grade(card.front, "unknown")}
              className="flex-1 rounded-lg border border-danger/50 bg-danger/10 py-3 text-sm font-medium text-danger hover:bg-danger/20"
            >
              还不会（画像 −0.15）
            </button>
            <button
              onClick={() => grade(card.front, "known")}
              className="flex-1 rounded-lg border border-accent2/50 bg-accent2/10 py-3 text-sm font-medium text-accent2 hover:bg-accent2/20"
            >
              会了（画像 +0.1）
            </button>
          </div>
        )}
        <button onClick={() => setPhase({ kind: "queue" })} className="mt-6 block w-full text-center text-xs text-text3 hover:text-text">
          结束本次复习
        </button>
      </div>
    );
  }

  /* ---------- 完成摘要 ---------- */
  if (phase.kind === "done") {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <p className="text-4xl">🎉</p>
        <h1 className="mt-3 text-xl font-bold text-white">复习完成</h1>
        <p className="mt-2 text-sm text-text2">
          《{phase.title}》· 会了 {phase.known} 张 · 还不会 {phase.unknown} 张
        </p>
        <p className="mt-1 text-xs text-text3">自评已回流到你的知识画像（「还不会」的知识点后续讲解会放慢节奏）</p>
        <div className="mt-6 flex justify-center gap-3">
          <button onClick={() => setPhase({ kind: "queue" })} className="rounded-lg bg-accent px-5 py-2 text-sm font-medium text-bg">
            返回队列
          </button>
          <Link href="/notes" className="rounded-lg border border-border px-5 py-2 text-sm text-text2 hover:border-accent hover:text-accent">
            回到笔记
          </Link>
        </div>
      </div>
    );
  }

  /* ---------- 队列 ---------- */
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">复习</h1>
          <p className="mt-0.5 text-sm text-text3">
            从笔记核心概念与术语表自动生成卡片；自评直接修正 AI 对你的认知。排序：从未复习 → 最久未复习 → 最薄弱优先
          </p>
        </div>
        <Link href="/notes" className="shrink-0 rounded-lg border border-border px-3.5 py-2 text-xs text-text2 hover:border-accent hover:text-accent">
          回到笔记
        </Link>
      </div>

      {queue === null ? (
        <div className="py-16 text-center text-sm text-text3">加载中…</div>
      ) : queue.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-panel/40 px-6 py-16 text-center">
          <p className="text-base font-medium text-text">还没有可复习的卡片</p>
          <p className="mt-1 text-sm text-text3">笔记需要包含「核心概念」或「术语表」章节（存为笔记会自动生成核心概念）</p>
          <Link href="/" className="mt-5 inline-block rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg">
            去学习
          </Link>
        </div>
      ) : (
        <div className="space-y-2.5">
          {queue.map((item, i) => (
            <div
              key={item.note.id}
              className="card-lift card-enter flex items-center gap-3 rounded-xl border border-border bg-panel px-4 py-3"
              style={{ animationDelay: `${Math.min(i * 45, 320)}ms` }}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-text">{item.note.title}</p>
                <p className="mt-0.5 text-xs text-text3">
                  {item.cardCount} 张卡片 · {item.note.domain}
                  {item.lastReview ? ` · 上次复习 ${formatDate(item.lastReview)}` : " · 从未复习"}
                  {item.minMastery !== null && ` · 最薄弱 ${item.minMastery.toFixed(2)}`}
                </p>
              </div>
              <button onClick={() => exportAnki(item.note.id, item.note.title)} className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs text-text3 hover:text-accent2" title="导出 Anki 可导入的 TSV">
                Anki
              </button>
              <button
                onClick={() => startSession(item.note.id)}
                className="shrink-0 rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-bg hover:opacity-90"
              >
                复习
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
