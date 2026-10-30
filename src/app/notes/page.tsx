"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { NoteDTO } from "@/lib/types";
import { formatDate, jsonFetch } from "@/lib/client/api";
import { EmptyState } from "@/components/common/EmptyState";

const STATUS_BADGE: Record<NoteDTO["status"], { text: string; cls: string }> = {
  draft: { text: "草稿", cls: "text-text3 border-border" },
  exported: { text: "已导出", cls: "text-accent2 border-accent2/40" },
  source_deleted: { text: "来源已删除", cls: "text-warn border-warn/40" },
};

interface ListResp {
  notes: NoteDTO[];
  domains: { domain: string; count: number }[];
  customDomains: string[];
}

interface GroupedResp {
  groups: { concept_id: string; concept_name: string; domain: string; notes: NoteDTO[] }[];
  ungrouped: NoteDTO[];
  customDomains: string[];
}

export default function NotesPage() {
  const [data, setData] = useState<ListResp | null>(null);
  const [grouped, setGrouped] = useState<GroupedResp | null>(null);
  const [view, setView] = useState<"flat" | "grouped">("flat");
  const [q, setQ] = useState("");
  const [domain, setDomain] = useState("");
  const [sort, setSort] = useState<"updated" | "created">("updated");
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [merging, setMerging] = useState(false);
  const [dragOverDomain, setDragOverDomain] = useState<string | null>(null);
  const [customDomains, setCustomDomains] = useState<string[]>([]);
  const [creatingLabel, setCreatingLabel] = useState(false);
  const [newLabelValue, setNewLabelValue] = useState("");
  /** 正在编辑分类的卡片 id（行内编辑器覆盖在卡片上） */
  const [editingCard, setEditingCard] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const router = useRouter();

  /** 拖拽/编辑后的领域设置（锁定，自动归类不再覆盖；新名登记为自定义标签） */
  async function setDomainFor(noteId: string, domain: string) {
    try {
      await jsonFetch(`/api/notes/${noteId}`, { method: "PATCH", body: JSON.stringify({ domain }) });
      setEditingCard(null);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "分类设置失败");
    }
  }

  async function createLabel() {
    const name = newLabelValue.trim();
    if (!name) return;
    try {
      const r = await jsonFetch<{ customDomains: string[] }>("/api/notes", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      setCustomDomains(r.customDomains);
      setNewLabelValue("");
      setCreatingLabel(false);
    } catch (e) {
      alert(e instanceof Error ? e.message : "创建失败");
    }
  }

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  async function mergeSelected() {
    if (merging || selected.size < 2) return;
    setMerging(true);
    try {
      const r = await jsonFetch<{ note: { id: string } }>("/api/notes/merge", {
        method: "POST",
        body: JSON.stringify({ note_ids: [...selected] }),
      });
      setSelected(new Set());
      setSelectMode(false);
      router.push(`/notes/${r.note.id}`);
    } catch (e) {
      alert(e instanceof Error ? e.message : "合并失败");
      setMerging(false);
    }
  }

  const load = useCallback(async () => {
    try {
      if (view === "grouped") {
        const g = await jsonFetch<GroupedResp>("/api/notes?grouped=1");
        setGrouped(g);
        setCustomDomains(g.customDomains);
        return;
      }
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (domain) params.set("domain", domain);
      params.set("sort", sort);
      const d = await jsonFetch<ListResp>(`/api/notes?${params.toString()}`);
      setData(d);
      setCustomDomains(d.customDomains);
    } catch {
      setData({ notes: [], domains: [], customDomains: [] });
      setGrouped({ groups: [], ungrouped: [], customDomains: [] });
    }
  }, [q, domain, sort, view]);

  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0); // 搜索防抖（q 变化会重建 load，此处显式声明依赖）
    return () => clearTimeout(t);
  }, [load, q]);

  const notes = view === "flat" ? (data?.notes ?? null) : null;
  const domains = view === "flat" ? (data?.domains ?? []) : [];

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">我的笔记</h1>
          <p className="mt-0.5 text-sm text-text3">
            由对话整理的结构化讲义，可导出 Markdown 带走；打开笔记后，划选术语可即时解答
          </p>
        </div>
        <Link href="/review" className="shrink-0 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg hover:opacity-90" title="用卡片自评复习，结果回流画像">
          开始复习
        </Link>
      </div>

      {/* 视图切换 + 搜索 + 排序 + 多选合并 */}
      <div className="mb-3 flex gap-2">
        <div className="flex rounded-lg border border-border bg-panel p-0.5">
          <button
            onClick={() => {
              setView("flat");
              setSelectMode(false);
              setSelected(new Set());
            }}
            className={`rounded-md px-3 py-1.5 text-xs transition-colors ${
              view === "flat" ? "bg-accent/15 text-accent" : "text-text2 hover:text-text"
            }`}
          >
            全部
          </button>
          <button
            onClick={() => setView("grouped")}
            className={`rounded-md px-3 py-1.5 text-xs transition-colors ${
              view === "grouped" ? "bg-accent/15 text-accent" : "text-text2 hover:text-text"
            }`}
            title="按笔记关联的概念分组展示"
          >
            按概念归组
          </button>
        </div>
        {view === "flat" && (
          <>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索标题、正文、术语表…"
              className="flex-1 rounded-lg border border-border bg-panel px-3.5 py-2 text-sm text-text placeholder:text-text3 focus:border-accent focus:outline-none"
            />
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as "updated" | "created")}
              className="rounded-lg border border-border bg-panel px-3 py-2 text-sm text-text2 focus:border-accent focus:outline-none"
            >
              <option value="updated">最近更新</option>
              <option value="created">最早创建</option>
            </select>
          </>
        )}
      </div>

      {/* 多选合并操作条（仅平铺视图） */}
      {view === "flat" && notes !== null && notes.length >= 2 && (
        <div className="mb-4 flex items-center gap-2 text-xs">
          <button
            onClick={() => {
              setSelectMode((v) => !v);
              setSelected(new Set());
            }}
            className={`rounded-lg border px-3 py-1.5 transition-colors ${
              selectMode ? "border-accent bg-accent/15 text-accent" : "border-border text-text2 hover:text-text"
            }`}
          >
            {selectMode ? "取消选择" : "选择合并"}
          </button>
          {selectMode && (
            <>
              <span className="text-text3">已选 {selected.size} 篇（2–6 篇可合并）</span>
              <button
                onClick={mergeSelected}
                disabled={selected.size < 2 || selected.size > 6 || merging}
                className="rounded-lg bg-accent px-3.5 py-1.5 font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {merging ? "合并中…" : "合并为总纲"}
              </button>
            </>
          )}
        </div>
      )}

      {/* 领域 chips（仅平铺视图）：自动归类 + 自定义标签；拖拽笔记到标签上可重新分类 */}
      {view === "flat" && (
        <div className="mb-4">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setDomain("")}
              className={`rounded-lg border px-2.5 py-1 text-xs transition-colors ${
                domain === "" ? "border-accent bg-accent/15 text-accent" : "border-border text-text2 hover:text-text"
              }`}
            >
              全部
            </button>
            {[...domains, ...customDomains.filter((c) => !domains.some((d) => d.domain === c)).map((c) => ({ domain: c, count: 0 }))].map(
              (d) => (
                <button
                  key={d.domain}
                  onClick={() => setDomain(domain === d.domain ? "" : d.domain)}
                  onDragOver={(e) => {
                    if (selectMode) return;
                    e.preventDefault();
                    setDragOverDomain(d.domain);
                  }}
                  onDragLeave={() => setDragOverDomain((v) => (v === d.domain ? null : v))}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOverDomain(null);
                    const id = e.dataTransfer.getData("text/note-id");
                    if (id) void setDomainFor(id, d.domain);
                  }}
                  className={`rounded-lg border px-2.5 py-1 text-xs transition-colors ${
                    dragOverDomain === d.domain
                      ? "border-accent2 bg-accent2/15 text-accent2 ring-1 ring-accent2/50"
                      : domain === d.domain
                        ? "border-accent bg-accent/15 text-accent"
                        : "border-border text-text2 hover:text-text"
                  }`}
                >
                  {d.domain} <span className="text-text3">{d.count > 0 ? d.count : ""}</span>
                </button>
              ),
            )}
            {creatingLabel ? (
              <span className="flex items-center gap-1.5">
                <input
                  value={newLabelValue}
                  onChange={(e) => setNewLabelValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void createLabel();
                    if (e.key === "Escape") setCreatingLabel(false);
                  }}
                  placeholder="标签名称"
                  autoFocus
                  className="w-28 rounded-lg border border-accent bg-panel px-2.5 py-1 text-xs text-text focus:outline-none"
                />
                <button onClick={() => void createLabel()} disabled={!newLabelValue.trim()} className="rounded-lg bg-accent px-2.5 py-1 text-xs font-medium text-bg disabled:opacity-40">
                  创建
                </button>
                <button onClick={() => setCreatingLabel(false)} className="text-xs text-text3 hover:text-text">
                  ×
                </button>
              </span>
            ) : (
              <button
                onClick={() => {
                  setCreatingLabel(true);
                  setNewLabelValue("");
                }}
                className="rounded-lg border border-dashed border-border px-2.5 py-1 text-xs text-text3 transition-colors hover:border-accent hover:text-accent"
                title="创建自定义标签（创建后可拖拽笔记进来）"
              >
                ＋ 新建分类
              </button>
            )}
          </div>
          {!selectMode && (
            <p className="mt-1.5 text-[11px] text-text3">
              提示：拖拽笔记卡片到上方标签可重新分类（手动设置的分类不会被自动归类覆盖）；也可在卡片上悬停点 🏷 单独分类
            </p>
          )}
        </div>
      )}

      {view === "grouped" ? (
        grouped === null ? (
          <div className="py-16 text-center text-sm text-text3">加载中…</div>
        ) : grouped.groups.length === 0 && grouped.ungrouped.length === 0 ? (
          <EmptyState
            title="还没有笔记"
            hint="在对话页点击「存为笔记」，AI 会把讲解整理成可复习的讲义"
            action={
              <Link href="/" className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg hover:opacity-90">
                去对话页学习
              </Link>
            }
          />
        ) : (
          <div className="space-y-6">
            {grouped.groups.map((g) => (
              <section key={g.concept_id}>
                <h2 className="mb-2.5 text-sm font-semibold text-text2">
                  {g.concept_name}
                  <span className="ml-2 rounded bg-panel2 px-1.5 py-0.5 text-[11px] font-normal text-text3">{g.domain}</span>
                  <span className="ml-1 text-xs font-normal text-text3">{g.notes.length} 篇</span>
                </h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  {g.notes.map((n, i) => renderCard(n, false, false, undefined, { enterDelay: i * 45 }))}
                </div>
              </section>
            ))}
            {grouped.ungrouped.length > 0 && (
              <section>
                <h2 className="mb-2.5 text-sm font-semibold text-text3">未关联概念</h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  {grouped.ungrouped.map((n, i) => renderCard(n, false, false, undefined, { enterDelay: i * 45 }))}
                </div>
              </section>
            )}
          </div>
        )
      ) : notes === null ? (
        <div className="py-16 text-center text-sm text-text3">加载中…</div>
      ) : notes.length === 0 ? (
        q || domain ? (
          <EmptyState title="没有匹配的笔记" hint="换个关键词，或清除筛选条件" />
        ) : (
          <EmptyState
            title="还没有笔记"
            hint="在对话页点击「存为笔记」，AI 会把讲解整理成可复习的讲义"
            action={
              <Link href="/" className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg hover:opacity-90">
                去对话页学习
              </Link>
            }
          />
        )
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {notes.map((n, i) =>
            renderCard(n, selectMode, selected.has(n.id), () => toggleSelect(n.id), {
              draggable: true,
              onDragStart: () => setDragOverDomain(null),
              isEditing: editingCard === n.id,
              editValue: editingCard === n.id ? editingValue : "",
              onEditValue: setEditingValue,
              onSaveEdit: () => void setDomainFor(n.id, editingValue),
              onCancelEdit: () => setEditingCard(null),
              onOpenEditor: () => {
                setEditingCard(n.id);
                setEditingValue(n.domain);
              },
              knownDomains: [...domains.map((d) => d.domain), ...customDomains],
              enterDelay: i * 45,
            }),
          )}
        </div>
      )}
    </div>
  );
}

function renderCard(
  n: NoteDTO,
  selectMode = false,
  isSelected = false,
  onToggle?: () => void,
  opts?: {
    draggable?: boolean;
    onDragStart?: () => void;
    isEditing?: boolean;
    editValue?: string;
    onEditValue?: (v: string) => void;
    onSaveEdit?: () => void;
    onCancelEdit?: () => void;
    onOpenEditor?: () => void;
    knownDomains?: string[];
    enterDelay?: number;
  },
) {
  const badge = STATUS_BADGE[n.status];
  const editing = Boolean(opts?.isEditing);
  const inner = (
    <>
      {selectMode && (
        <span
          className={`absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded border text-xs ${
            isSelected ? "border-accent bg-accent text-bg" : "border-border text-transparent"
          }`}
        >
          ✓
        </span>
      )}
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-sm font-medium text-text group-hover:text-white">{n.title}</p>
        <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[11px] ${badge.cls}`}>{badge.text}</span>
      </div>
      <div className="mt-1.5 flex items-center gap-1.5">
        <span className="rounded bg-panel2 px-1.5 py-0.5 text-[11px] text-text2" title={n.domain_locked ? "手动设置的分类" : undefined}>
          {n.domain}
          {n.domain_locked ? " · 手动" : ""}
        </span>
        {n.anchors.length > 0 && <span className="text-[11px] text-text3">{n.anchors.length} 个溯源锚点</span>}
      </div>
      <p className="mt-1 truncate text-xs text-text3">
        {n.status === "source_deleted" ? "来源会话已删除" : `来自：${n.source_title ?? "独立笔记"}`}
      </p>
      <p className="mt-0.5 text-xs text-text3">
        v{n.version} · {formatDate(n.updated_at)}
      </p>
    </>
  );

  // 行内分类编辑器（编辑态覆盖层）
  const editorOverlay = editing ? (
    <div
      className="absolute inset-0 z-10 rounded-xl border border-accent bg-panel/95 p-3.5"
      onClick={(e) => e.stopPropagation()}
    >
      <p className="mb-2 text-[11px] text-text2">设置分类（手动后不被自动覆盖）</p>
      <div className="mb-2 flex flex-wrap gap-1">
        {[...new Set([n.domain, ...(opts?.knownDomains ?? [])])].map((d) => (
          <button
            key={d}
            onClick={() => opts?.onEditValue?.(d)}
            className={`rounded border px-1.5 py-0.5 text-[11px] transition-colors ${
              opts?.editValue === d ? "border-accent bg-accent/15 text-accent" : "border-border text-text2 hover:text-text"
            }`}
          >
            {d}
          </button>
        ))}
      </div>
      <div className="flex gap-1.5">
        <input
          value={opts?.editValue ?? ""}
          onChange={(e) => opts?.onEditValue?.(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && opts?.editValue?.trim()) opts.onSaveEdit?.();
            if (e.key === "Escape") opts?.onCancelEdit?.();
          }}
          placeholder="或输入新分类名"
          className="min-w-0 flex-1 rounded border border-border bg-panel2 px-2 py-1 text-xs text-text focus:border-accent focus:outline-none"
        />
        <button
          onClick={() => opts?.onSaveEdit?.()}
          disabled={!opts?.editValue?.trim()}
          className="rounded bg-accent px-2.5 py-1 text-xs font-medium text-bg disabled:opacity-40"
        >
          保存
        </button>
        <button onClick={() => opts?.onCancelEdit?.()} className="rounded border border-border px-2 py-1 text-xs text-text2">
          ×
        </button>
      </div>
    </div>
  ) : null;

  // 悬停分类按钮
  const tagBtn =
    !selectMode && !editing ? (
      <button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          opts?.onOpenEditor?.();
        }}
        className="absolute right-10 top-3 rounded border border-border bg-panel2 px-1.5 py-0.5 text-[11px] text-text3 opacity-0 transition-opacity hover:text-accent group-hover:opacity-100"
        title="设置分类"
      >
        🏷
      </button>
    ) : null;

  const dragProps =
    opts?.draggable && !selectMode && !editing
      ? {
          draggable: true,
          onDragStart: (e: React.DragEvent) => {
            e.dataTransfer.setData("text/note-id", n.id);
            e.dataTransfer.setData("text/plain", n.title);
            opts?.onDragStart?.();
          },
        }
      : {};
  // 动效：悬停放大上浮 + 进场错落（编辑态静止，避免覆盖层抖动）
  const motion = {
    className: editing ? "" : "card-lift card-enter",
    style: opts?.enterDelay ? { animationDelay: `${Math.min(opts.enterDelay, 360)}ms` } : undefined,
  };
  if (selectMode) {
    return (
      <button
        key={n.id}
        onClick={onToggle}
        className={`card-lift card-enter relative block w-full rounded-xl border bg-panel px-4 py-3.5 text-left transition-colors ${
          isSelected ? "border-accent ring-1 ring-accent/50" : "border-border hover:border-accent/60"
        }`}
        style={motion.style}
      >
        {inner}
      </button>
    );
  }
  return (
    <Link
      key={n.id}
      href={`/notes/${n.id}`}
      className={`group relative block rounded-xl border border-border bg-panel px-4 py-3.5 ${motion.className}`}
      style={motion.style}
      {...dragProps}
      onClick={(e) => {
        if (editing) e.preventDefault();
      }}
    >
      {inner}
      {tagBtn}
      {editorOverlay}
    </Link>
  );
}
