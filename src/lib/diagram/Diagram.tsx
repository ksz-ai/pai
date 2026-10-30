"use client";

import { useId, useMemo } from "react";
import { validateDiagramSpec, type DiagramElement, type DiagramSpec, type P2 } from "./spec";

/**
 * 图示渲染器（G 批次）：DiagramSpec（数学坐标）→ SVG。
 * - 自动取景：收集全部图元坐标（含显式坐标轴范围）→ 包围盒 + 10% 边距 → 统一缩放；
 * - Y 轴翻转由这里完成（数学坐标 y 向上 → 屏幕 y 向下）；
 * - 校验失败 → 细提示占位，讲解正文完全不受影响（降级链思想）。
 */

const INK = "#475569";
const ACCENT = "#0ea5e9";
const LABEL = "#475569";
const AXIS = "#94a3b8";
const FILL_DEFAULT = "#0ea5e91a";
const W_TARGET = 480;

interface Layout {
  w: number;
  h: number;
  k: number;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  X: (x: number) => number;
  Y: (y: number) => number;
}

function elementPoints(el: DiagramElement): P2[] {
  switch (el.type) {
    case "point":
    case "label":
      return [el.at];
    case "segment":
      return [el.from, el.to];
    case "polygon":
      return el.points;
    case "angle":
      return [el.at, el.from, el.to];
    case "circle": {
      const [cx, cy] = el.center;
      return [[cx - el.r, cy], [cx + el.r, cy], [cx, cy - el.r], [cx, cy + el.r]];
    }
  }
}

function numPair(arr: number[]): { min: number; max: number } {
  return { min: Math.min(...arr), max: Math.max(...arr) };
}

function computeLayout(spec: DiagramSpec): Layout {
  const pts = spec.elements.flatMap(elementPoints);
  let xs = pts.map((p) => p[0]);
  let ys = pts.map((p) => p[1]);
  if (spec.axes?.visible) {
    if (spec.axes.xRange) xs = [...xs, spec.axes.xRange[0], spec.axes.xRange[1]];
    if (spec.axes.yRange) ys = [...ys, spec.axes.yRange[0], spec.axes.yRange[1]];
  }
  let { min: xMin, max: xMax } = numPair(xs);
  let { min: yMin, max: yMax } = numPair(ys);
  if (!Number.isFinite(xMin) || !Number.isFinite(yMin)) {
    xMin = 0;
    xMax = 1;
    yMin = 0;
    yMax = 1;
  }
  // 退化保护：单点/共线/横竖排布时给最小可视跨度
  let dx = xMax - xMin;
  let dy = yMax - yMin;
  if (!(dx > 0)) dx = Math.max(1, Math.abs(xMax) * 0.01, 0.5);
  if (!(dy > 0)) dy = Math.max(1, Math.abs(yMax) * 0.01, 0.5);
  const pad = Math.max(Math.max(dx, dy) * 0.1, 0.25);
  const k = W_TARGET / (dx + 2 * pad);
  const w = W_TARGET;
  const h = (dy + 2 * pad) * k;
  // 画布边界（数学坐标）：四周各延 pad；X 先延后映射，Y 先翻转再映射
  const xLeft = xMin - pad;
  const yTop = yMax + pad;
  return {
    w,
    h,
    k,
    xMin: xLeft,
    xMax: xMax + pad,
    yMin: yTop - h / k,
    yMax: yTop,
    X: (x) => (x - xLeft) * k,
    Y: (y) => (yTop - y) * k,
  };
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** 带白描边的文字（叠加在图元上也可读） */
function LabelText({ x, y, text, anchor = "middle" }: { x: number; y: number; text: string; anchor?: "start" | "middle" | "end" }) {
  return (
    <text x={fmt(x)} y={fmt(y)} textAnchor={anchor} fontSize={13} fill={LABEL} stroke="#ffffff" strokeWidth={3.5} paintOrder="stroke">
      {text}
    </text>
  );
}

function ElementView({ el, L, arrowId }: { el: DiagramElement; L: Layout; arrowId: string }) {
  switch (el.type) {
    case "point": {
      const cx = L.X(el.at[0]);
      const cy = L.Y(el.at[1]);
      return (
        <g>
          <circle cx={fmt(cx)} cy={fmt(cy)} r={3.5} fill={ACCENT} />
          {el.label && <LabelText x={cx + 8} y={cy - 9} text={el.label} anchor="start" />}
        </g>
      );
    }
    case "segment": {
      const x1 = L.X(el.from[0]);
      const y1 = L.Y(el.from[1]);
      const x2 = L.X(el.to[0]);
      const y2 = L.Y(el.to[1]);
      const len = Math.hypot(x2 - x1, y2 - y1) || 1;
      let ox = (-(y2 - y1) / len) * 12;
      let oy = ((x2 - x1) / len) * 12;
      if (oy > 0) {
        ox = -ox;
        oy = -oy; // 标签固定放在视觉上方一侧
      }
      return (
        <g>
          <line
            x1={fmt(x1)}
            y1={fmt(y1)}
            x2={fmt(x2)}
            y2={fmt(y2)}
            stroke={INK}
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeDasharray={el.dashed ? "5 4" : undefined}
            markerEnd={el.arrow ? `url(#${arrowId})` : undefined}
          />
          {el.label && <LabelText x={(x1 + x2) / 2 + ox} y={(y1 + y2) / 2 + oy} text={el.label} />}
        </g>
      );
    }
    case "polygon": {
      const pts = el.points.map((p) => `${fmt(L.X(p[0]))},${fmt(L.Y(p[1]))}`).join(" ");
      const cx = el.points.reduce((s, p) => s + p[0], 0) / el.points.length;
      const cy = el.points.reduce((s, p) => s + p[1], 0) / el.points.length;
      return (
        <g>
          <polygon
            points={pts}
            fill={el.fill ?? FILL_DEFAULT}
            stroke={el.stroke ?? INK}
            strokeWidth={1.8}
            strokeLinejoin="round"
          />
          {el.label && <LabelText x={L.X(cx)} y={L.Y(cy)} text={el.label} />}
        </g>
      );
    }
    case "circle": {
      const cx = L.X(el.center[0]);
      const cy = L.Y(el.center[1]);
      return (
        <g>
          <circle
            cx={fmt(cx)}
            cy={fmt(cy)}
            r={fmt(el.r * L.k)}
            fill="none"
            stroke={INK}
            strokeWidth={1.8}
            strokeDasharray={el.dashed ? "5 4" : undefined}
          />
          {el.label && <LabelText x={cx} y={cy - el.r * L.k - 9} text={el.label} />}
        </g>
      );
    }
    case "angle": {
      const [ax, ay] = el.at;
      const v1: P2 = [el.from[0] - ax, el.from[1] - ay];
      const v2: P2 = [el.to[0] - ax, el.to[1] - ay];
      const l1 = Math.hypot(v1[0], v1[1]);
      const l2 = Math.hypot(v2[0], v2[1]);
      if (l1 < 1e-6 || l2 < 1e-6) return null;
      const reach = Math.min(l1, l2) * 0.22;
      if (el.rightAngle) {
        const u1: P2 = [(v1[0] / l1) * reach, (v1[1] / l1) * reach];
        const u2: P2 = [(v2[0] / l2) * reach, (v2[1] / l2) * reach];
        const p1: P2 = [ax + u1[0], ay + u1[1]];
        const pm: P2 = [ax + u1[0] + u2[0], ay + u1[1] + u2[1]];
        const p2: P2 = [ax + u2[0], ay + u2[1]];
        const pts = [p1, pm, p2].map((p) => `${fmt(L.X(p[0]))},${fmt(L.Y(p[1]))}`).join(" ");
        return <polyline points={pts} fill="none" stroke={INK} strokeWidth={1.5} strokeLinejoin="round" />;
      }
      // 弧线：从 v1 方向扫到 v2 方向（取劣角）
      const a1 = Math.atan2(v1[1], v1[0]);
      let sweep = Math.atan2(v2[1], v2[0]) - a1;
      while (sweep > Math.PI) sweep -= 2 * Math.PI;
      while (sweep < -Math.PI) sweep += 2 * Math.PI;
      const n = 16;
      const pts: string[] = [];
      for (let i = 0; i <= n; i++) {
        const t = a1 + (sweep * i) / n;
        pts.push(`${fmt(L.X(ax + reach * Math.cos(t)))},${fmt(L.Y(ay + reach * Math.sin(t)))}`);
      }
      return <polyline points={pts.join(" ")} fill="none" stroke={INK} strokeWidth={1.5} strokeLinejoin="round" />;
    }
    case "label":
      return <LabelText x={L.X(el.at[0])} y={L.Y(el.at[1])} text={el.text} />;
  }
}

function DiagramSvg({ spec }: { spec: DiagramSpec }) {
  const L = useMemo(() => computeLayout(spec), [spec]);
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const arrowId = `arrow-${uid}`;
  const axisArrowId = `axis-${uid}`;
  const xAxisVisible = spec.axes?.visible === true && 0 >= L.yMin && 0 <= L.yMax;
  const yAxisVisible = spec.axes?.visible === true && 0 >= L.xMin && 0 <= L.xMax;

  return (
    <svg
      role="img"
      viewBox={`0 0 ${fmt(L.w)} ${fmt(L.h)}`}
      className="my-1 h-auto w-full max-w-md rounded-lg border border-border bg-white/70"
      style={{ overflow: "visible" }}
    >
      <defs>
        <marker id={arrowId} viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10 z" fill={INK} />
        </marker>
        <marker id={axisArrowId} viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10 z" fill={AXIS} />
        </marker>
      </defs>

      {xAxisVisible && (
        <line x1={6} y1={fmt(L.Y(0))} x2={fmt(L.w - 6)} y2={fmt(L.Y(0))} stroke={AXIS} strokeWidth={1} markerEnd={`url(#${axisArrowId})`} />
      )}
      {yAxisVisible && (
        <line x1={fmt(L.X(0))} y1={fmt(L.h - 6)} x2={fmt(L.X(0))} y2={6} stroke={AXIS} strokeWidth={1} markerEnd={`url(#${axisArrowId})`} />
      )}
      {xAxisVisible && yAxisVisible && <LabelText x={L.X(0) - 7} y={L.Y(0) + 14} text="O" anchor="end" />}

      {spec.elements.map((el, i) => (
        <ElementView key={i} el={el} L={L} arrowId={arrowId} />
      ))}
    </svg>
  );
}

export function Diagram({ raw }: { raw: string }) {
  const { spec, error } = useMemo(() => {
    try {
      const parsed: unknown = JSON.parse(raw);
      const r = validateDiagramSpec(parsed);
      return r.ok ? { spec: r.spec, error: null as string | null } : { spec: null, error: r.error };
    } catch {
      return { spec: null, error: "JSON 解析失败" as string | null };
    }
  }, [raw]);

  if (!spec) {
    return (
      <div className="my-1 inline-block rounded-lg border border-border bg-panel2/40 px-3 py-1.5 text-xs text-text3">
        📐 图示暂未渲染（{error}）
      </div>
    );
  }
  return <DiagramSvg spec={spec} />;
}
