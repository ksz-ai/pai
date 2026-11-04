"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { jsonFetch } from "@/lib/client/api";
import { Spinner } from "@/components/common/EmptyState";

interface GraphNode {
  id: string;
  name: string;
  domain: string;
  mastery: number;
  source: string;
  note_count: number;
  evidence_count: number;
  evidence: { conversation_id: string; slot: string }[];
  relatedNotes: { id: string; title: string }[];
}
interface GraphLink {
  source: string;
  target: string;
  weight: number;
}
interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

interface SimNode extends GraphNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  fixed: boolean;
}

function masteryColor(m: number): string {
  if (m < 0.4) return "#e87a7a";
  if (m < 0.7) return "#e8b04b";
  return "#5fd39a";
}

const W = 980;
const H = 540;

/** 手写力导向布局（零依赖）：斥力 + 弹簧 + 向心力，约 300 tick 收敛 */
function simulate(nodes: SimNode[], links: GraphLink[], ticks: number) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const springs = links.map((l) => ({ a: byId.get(l.source), b: byId.get(l.target), len: 150 + l.weight * 20 }));
  for (let t = 0; t < ticks; t++) {
    // 斥力
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const d2 = Math.max(dx * dx + dy * dy, 100);
        const f = 2600 / d2;
        const d = Math.sqrt(d2);
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        a.vx += fx;
        a.vy += fy;
        b.vx -= fx;
        b.vy -= fy;
      }
    }
    // 弹簧
    for (const s of springs) {
      if (!s.a || !s.b) continue;
      const dx = s.b.x - s.a.x;
      const dy = s.b.y - s.a.y;
      const d = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
      const f = (d - s.len) * 0.015;
      s.a.vx += (dx / d) * f;
      s.a.vy += (dy / d) * f;
      s.b.vx -= (dx / d) * f;
      s.b.vy -= (dy / d) * f;
    }
    // 向心 + 阻尼 + 限位
    for (const n of nodes) {
      if (n.fixed) {
        n.vx = 0;
        n.vy = 0;
        continue;
      }
      n.vx += (W / 2 - n.x) * 0.004;
      n.vy += (H / 2 - n.y) * 0.006;
      n.vx *= 0.82;
      n.vy *= 0.82;
      n.x = Math.min(W - 70, Math.max(70, n.x + Math.max(-12, Math.min(12, n.vx))));
      n.y = Math.min(H - 46, Math.max(40, n.y + Math.max(-12, Math.min(12, n.vy))));
    }
  }
}

export default function GraphPage() {
  return (
    <Suspense fallback={<div className="flex h-[60vh] items-center justify-center"><Spinner /></div>}>
      <GraphPageInner />
    </Suspense>
  );
}

function GraphPageInner() {
  const [data, setData] = useState<GraphData | null>(null);
  const [domain, setDomain] = useState("");
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const simRef = useRef<SimNode[]>([]);
  const frameRef = useRef<number | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    jsonFetch<GraphData>("/api/graph").then(setData).catch(() => setData({ nodes: [], links: [] }));
  }, []);

  const domains = useMemo(() => {
    const dist = new Map<string, number>();
    for (const n of data?.nodes ?? []) dist.set(n.domain, (dist.get(n.domain) ?? 0) + 1);
    return [...dist.entries()].sort((a, b) => b[1] - a[1]);
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return null;
    if (!domain) return data;
    const nodes = data.nodes.filter((n) => n.domain === domain);
    const ids = new Set(nodes.map((n) => n.id));
    return { nodes, links: data.links.filter((l) => ids.has(l.source) && ids.has(l.target)) };
  }, [data, domain]);

  // 数据变化 → 初始化模拟节点并跑布局
  useEffect(() => {
    if (!filtered) return;
    const nodes: SimNode[] = filtered.nodes.map((n, i) => ({
      ...n,
      x: W / 2 + Math.cos((i / Math.max(filtered.nodes.length, 1)) * Math.PI * 2) * 260,
      y: H / 2 + Math.sin((i / Math.max(filtered.nodes.length, 1)) * Math.PI * 2) * 160,
      vx: 0,
      vy: 0,
      fixed: false,
    }));
    simRef.current = nodes;
    simulate(nodes, filtered.links, 320);
    setTick((t) => t + 1);
  }, [filtered]);

  // 拖拽节点
  function nodePointerDown(e: React.PointerEvent, node: SimNode) {
    e.preventDefault();
    node.fixed = true;
    const svg = svgRef.current;
    if (!svg) return;
    const move = (ev: PointerEvent) => {
      const rect = svg.getBoundingClientRect();
      node.x = Math.min(W - 70, Math.max(70, ev.clientX - rect.left));
      node.y = Math.min(H - 40, Math.max(36, ev.clientY - rect.top));
      setTick((t) => t + 1);
    };
    const up = () => {
      node.fixed = false;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  const nodes = simRef.current;
  const links = filtered?.links ?? [];
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">知识图谱</h1>
          <p className="mt-0.5 text-sm text-text3">
            学过的概念与它们的关联——颜色 = 掌握度（红 &lt;0.4 · 黄 0.4–0.7 · 绿 ≥0.7），大小 = 证据与笔记数，连线 = 同笔记共现
          </p>
        </div>
        <Link href="/notes" className="shrink-0 rounded-lg border border-border px-3.5 py-2 text-xs text-text2 hover:border-accent hover:text-accent">
          回到笔记
        </Link>
      </div>

      {/* 领域筛选 */}
      <div className="mb-3 flex flex-wrap gap-2">
        <button
          onClick={() => setDomain("")}
          className={`rounded-lg border px-2.5 py-1 text-xs transition-colors ${
            domain === "" ? "border-accent bg-accent/15 text-accent" : "border-border text-text2 hover:text-text"
          }`}
        >
          全部
        </button>
        {domains.map(([d, count]) => (
          <button
            key={d}
            onClick={() => setDomain(domain === d ? "" : d)}
            className={`rounded-lg border px-2.5 py-1 text-xs transition-colors ${
              domain === d ? "border-accent bg-accent/15 text-accent" : "border-border text-text2 hover:text-text"
            }`}
          >
            {d} <span className="text-text3">{count}</span>
          </button>
        ))}
      </div>

      <div className="relative h-[560px] overflow-hidden rounded-xl border border-border bg-panel">
        {!filtered ? (
          <div className="flex h-full items-center justify-center">
            <Spinner label="加载图谱…" />
          </div>
        ) : filtered.nodes.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <p className="text-sm text-text2">还没有可展示的概念</p>
            <p className="mt-1 text-xs text-text3">去对话页学几个概念，图谱会自动生长</p>
            <Link href="/" className="mt-4 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg">
              开始学习
            </Link>
          </div>
        ) : (
          <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="h-full w-full select-none" style={{ touchAction: "none" }}>
            {/* 连线 */}
            {links.map((l, i) => {
              const a = byId.get(l.source);
              const b = byId.get(l.target);
              if (!a || !b) return null;
              return (
                <g key={i}>
                  <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="rgba(124,154,255,0.3)" strokeWidth={Math.min(3, 0.6 + l.weight * 0.5)} />
                  {l.weight > 1 && (
                    <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 4} textAnchor="middle" fontSize="10" fill="#5a6478">
                      ×{l.weight}
                    </text>
                  )}
                </g>
              );
            })}
            {/* 节点 */}
            {nodes.map((n) => (
              <g
                key={n.id}
                style={{ cursor: "pointer" }}
                onPointerDown={(e) => nodePointerDown(e, n)}
                onClick={() => setSelected(n)}
              >
                <circle cx={n.x} cy={n.y} r={14 + Math.min(10, n.evidence_count + n.note_count)} fill={masteryColor(n.mastery)} fillOpacity="0.9" stroke={selected?.id === n.id ? "#fff" : "#0f1115"} strokeWidth={selected?.id === n.id ? 2.5 : 1.5} />
                <text x={n.x} y={n.y + 30 + Math.min(10, n.evidence_count + n.note_count) * 0.4} textAnchor="middle" fontSize="12" fill="#aab2c2">
                  {n.name}
                </text>
              </g>
            ))}
          </svg>
        )}
        {/* 节点详情侧栏 */}
        {selected && filtered && (
          <div className="absolute right-3 top-3 w-72 rounded-xl border border-border bg-panel/95 p-4 shadow-2xl backdrop-blur">
            <div className="mb-2 flex items-start justify-between">
              <p className="text-sm font-semibold text-white">{selected.name}</p>
              <button onClick={() => setSelected(null)} className="text-text3 hover:text-text">
                ×
              </button>
            </div>
            <p className="text-xs text-text3">{selected.domain}</p>
            <div className="mt-3">
              <p className="mb-1 flex items-center gap-2 text-xs text-text2">
                掌握度
                <span className="h-1.5 w-16 overflow-hidden rounded-full bg-panel2">
                  <span className="block h-full rounded-full" style={{ width: `${Math.round(selected.mastery * 100)}%`, background: masteryColor(selected.mastery) }} />
                </span>
                <span className="tabular-nums">{selected.mastery.toFixed(2)}</span>
              </p>
              <p className="text-xs text-text3">
                证据 {selected.evidence_count} 条 · 出现于 {selected.note_count} 篇笔记
              </p>
            </div>
            {selected.evidence.length > 0 && (
              <div className="mt-3">
                <p className="mb-1 text-xs text-text3">证据来源</p>
                <div className="flex flex-wrap gap-1.5">
                  {selected.evidence.map((e, i) => (
                    <Link
                      key={i}
                      href={`/chat/${e.conversation_id}?slot=${e.slot}`}
                      className="rounded border border-border bg-panel2 px-2 py-0.5 text-[11px] text-text2 hover:border-accent hover:text-accent"
                    >
                      对话第 {Number(e.slot) + 1} 条
                    </Link>
                  ))}
                </div>
              </div>
            )}
            {selected.relatedNotes.length > 0 && (
              <div className="mt-3">
                <p className="mb-1 text-xs text-text3">相关笔记</p>
                <div className="space-y-1">
                  {selected.relatedNotes.slice(0, 4).map((x) => (
                    <Link key={x.id} href={`/notes/${x.id}`} className="block truncate rounded bg-panel2 px-2 py-1 text-[11px] text-text2 hover:text-accent">
                      {x.title}
                    </Link>
                  ))}
                </div>
              </div>
            )}
            <Link href="/profile" className="mt-3 block rounded-md border border-border py-1.5 text-center text-xs text-text2 hover:border-accent hover:text-accent">
              在画像中调整 →
            </Link>
          </div>
        )}
      </div>
      <p className="mt-2 text-center text-[11px] text-text3">拖拽节点调整布局 · 点击节点查看详情与证据</p>
    </div>
  );
}
