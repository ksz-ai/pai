/**
 * 图示 DSL v1（G 批次）：几何图元的类型与校验。
 *
 * 设计原则（对应规划 docs/新功能指南-图示讲解.md）：
 * - LLM 只在数学坐标系（x 向右、y 向上）描述图元，屏幕翻转 / 缩放 / 取景由前端渲染器保证；
 * - 所有进入 SVG 属性的颜色严格白名单（十六进制 / none），杜绝注入；
 * - 校验失败 → 优雅降级占位，讲解文字不受影响（沿用概念抽取"降级链"思想）。
 */

export type P2 = [number, number];

/** 坐标轴（可选）：visible 时画 x/y 轴，range 可显式指定（未指定则取图元包围盒） */
export interface DiagramAxes {
  visible?: boolean;
  xRange?: [number, number];
  yRange?: [number, number];
}

export type DiagramElement =
  | { type: "point"; at: P2; label?: string }
  | { type: "segment"; from: P2; to: P2; label?: string; arrow?: boolean; dashed?: boolean }
  | { type: "polygon"; points: P2[]; label?: string; fill?: string; stroke?: string }
  | { type: "circle"; center: P2; r: number; label?: string; dashed?: boolean }
  | { type: "angle"; at: P2; from: P2; to: P2; rightAngle?: boolean }
  | { type: "label"; at: P2; text: string };

export interface DiagramSpec {
  axes?: DiagramAxes;
  elements: DiagramElement[];
}

export type DiagramValidation =
  | { ok: true; spec: DiagramSpec }
  | { ok: false; error: string };

const MAX_ELEMENTS = 16;
const MAX_COORD = 10_000;
const MAX_TEXT = 80;
const COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$|^none$/;

const fail = (error: string): DiagramValidation => ({ ok: false, error });

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= MAX_COORD;
}

function isP2(v: unknown): v is P2 {
  return Array.isArray(v) && v.length === 2 && isNum(v[0]) && isNum(v[1]);
}

function isText(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0 && v.length <= MAX_TEXT;
}

function isColor(v: unknown): v is string {
  return typeof v === "string" && COLOR_RE.test(v);
}

function parseElements(raw: unknown): DiagramValidation {
  if (!Array.isArray(raw) || raw.length === 0) return fail("elements 必须是非空数组");
  if (raw.length > MAX_ELEMENTS) return fail(`元素数量超限（最多 ${MAX_ELEMENTS} 个）`);

  const elements: DiagramElement[] = [];
  for (const el of raw) {
    if (!el || typeof el !== "object" || Array.isArray(el)) return fail("图元必须是对象");
    const e = el as Record<string, unknown>;
    switch (e.type) {
      case "point": {
        if (!isP2(e.at)) return fail("point.at 非法");
        if (e.label !== undefined && !isText(e.label)) return fail("point.label 非法");
        elements.push(
          typeof e.label === "string"
            ? { type: "point", at: e.at, label: e.label }
            : { type: "point", at: e.at },
        );
        break;
      }
      case "segment": {
        if (!isP2(e.from) || !isP2(e.to)) return fail("segment.from/to 非法");
        if (e.label !== undefined && !isText(e.label)) return fail("segment.label 非法");
        elements.push({
          type: "segment",
          from: e.from,
          to: e.to,
          ...(typeof e.label === "string" ? { label: e.label } : {}),
          ...(e.arrow === true ? { arrow: true } : {}),
          ...(e.dashed === true ? { dashed: true } : {}),
        });
        break;
      }
      case "polygon": {
        if (!Array.isArray(e.points) || e.points.length < 2 || e.points.length > 16 || !e.points.every(isP2))
          return fail("polygon.points 非法（2–16 个顶点）");
        if (e.label !== undefined && !isText(e.label)) return fail("polygon.label 非法");
        if (e.fill !== undefined && !isColor(e.fill)) return fail("polygon.fill 必须是十六进制颜色或 none");
        if (e.stroke !== undefined && !isColor(e.stroke)) return fail("polygon.stroke 必须是十六进制颜色或 none");
        elements.push({
          type: "polygon",
          points: e.points,
          ...(typeof e.label === "string" ? { label: e.label } : {}),
          ...(typeof e.fill === "string" ? { fill: e.fill } : {}),
          ...(typeof e.stroke === "string" ? { stroke: e.stroke } : {}),
        });
        break;
      }
      case "circle": {
        if (!isP2(e.center)) return fail("circle.center 非法");
        if (!isNum(e.r) || e.r <= 0) return fail("circle.r 必须为正数");
        if (e.label !== undefined && !isText(e.label)) return fail("circle.label 非法");
        elements.push({
          type: "circle",
          center: e.center,
          r: e.r,
          ...(typeof e.label === "string" ? { label: e.label } : {}),
          ...(e.dashed === true ? { dashed: true } : {}),
        });
        break;
      }
      case "angle": {
        if (!isP2(e.at) || !isP2(e.from) || !isP2(e.to)) return fail("angle.at/from/to 非法");
        elements.push({ type: "angle", at: e.at, from: e.from, to: e.to, ...(e.rightAngle !== false ? { rightAngle: true } : {}) });
        break;
      }
      case "label": {
        if (!isP2(e.at)) return fail("label.at 非法");
        if (!isText(e.text)) return fail("label.text 非法");
        elements.push({ type: "label", at: e.at, text: e.text });
        break;
      }
      default:
        return fail(`未知图元类型：${String(e.type)}`);
    }
  }
  return { ok: true, spec: { elements } };
}

/** 校验原始 JSON（unknown）→ 合法 spec 或失败原因。纯函数，可测试。 */
export function validateDiagramSpec(raw: unknown): DiagramValidation {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail("spec 必须是一个 JSON 对象");
  const o = raw as Record<string, unknown>;

  let axes: DiagramAxes | undefined;
  if (o.axes !== undefined) {
    if (o.axes === true) {
      axes = { visible: true };
    } else if (o.axes === false || o.axes === null) {
      axes = undefined;
    } else if (typeof o.axes === "object" && !Array.isArray(o.axes)) {
      const a = o.axes as Record<string, unknown>;
      axes = {};
      if (a.visible !== undefined) {
        if (typeof a.visible !== "boolean") return fail("axes.visible 必须是布尔值");
        axes.visible = a.visible;
      }
      for (const key of ["xRange", "yRange"] as const) {
        const v = a[key];
        if (v === undefined) continue;
        if (!Array.isArray(v) || v.length !== 2 || !isNum(v[0]) || !isNum(v[1]) || v[0] >= v[1])
          return fail(`axes.${key} 必须是 [min, max] 且 min < max`);
        axes[key] = [v[0], v[1]];
      }
    } else {
      return fail("axes 格式非法");
    }
  }

  const elements = parseElements(o.elements);
  if (!elements.ok) return elements;
  const spec: DiagramSpec = { elements: elements.spec.elements };
  if (axes) spec.axes = axes;
  return { ok: true, spec };
}
