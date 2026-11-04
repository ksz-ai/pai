/* ============================================================
   PAI 个人 AI 学习 · 项目展示 PPT
   基于 prototypes/pai-redesign 的实际页面与数据
   17 页 · 16:9 · PptxGenJS 可编辑输出
   ============================================================ */
const path = require("path");
const pptxgen = require("pptxgenjs");
const { imageSizingCrop } = require("./helpers/image");
const { warnIfSlideHasOverlaps, warnIfSlideElementsOutOfBounds } = require("./helpers/layout");
const { safeOuterShadow } = require("./helpers/util");

const OUT = path.join(__dirname, "PAI-个人AI学习-原型项目展示.pptx");
const SHOTS = path.join(__dirname, "assets", "shots");
const TOTAL = 17;

const C = {
  bg: "F7F5EF",
  surface: "FFFFFF",
  surfaceAlt: "EFEDE6",
  primary: "1D6F5F",
  primaryHover: "17594D",
  primarySoft: "E6F1EC",
  accent: "B4762E",
  accentSoft: "F6EBDC",
  text: "1F2320",
  sub: "636B63",
  border: "DDD8CB",
  borderStrong: "C9C2B1",
  danger: "A93B30",
  white: "FFFFFF"
};

const F = {
  display: "SimSun",
  body: "Microsoft YaHei",
  mono: "Consolas"
};

const M = 0.68;
const CW = 13.333;
const CH = 7.5;

const pptx = new pptxgen();
pptx.layout = "LAYOUT_WIDE";
pptx.author = "PAI 原型项目";
pptx.company = "PAI Personal AI Learning";
pptx.subject = "PAI 个人 AI 学习 · 高保真交互原型项目展示";
pptx.title = "PAI 个人 AI 学习 · 原型项目展示";
pptx.lang = "zh-CN";

/* ---------------------------- 基础组件 ---------------------------- */
function bg(slide) {
  slide.background = { color: C.bg };
}

function accentTop(slide) {
  slide.addShape(pptx.ShapeType.rect, {
    x: M, y: 0.02, w: 1.0, h: 0.055,
    fill: { color: C.primary }, line: { color: C.primary, width: 0 }
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: M + 1.03, y: 0.02, w: 0.22, h: 0.055,
    fill: { color: C.accent }, line: { color: C.accent, width: 0 }
  });
}

function txt(slide, text, opts) {
  slide.addText(text, Object.assign({
    margin: 0,
    fontFace: F.body,
    fontSize: 11,
    color: C.text,
    valign: "top",
    breakLine: false
  }, opts || {}));
}

function card(slide, x, y, w, h, opts) {
  const o = Object.assign({ fill: C.surface, line: C.border, lineWidth: 0.6, radius: 0.09, shadow: true }, opts || {});
  slide.addShape(pptx.ShapeType.roundRect, {
    x: x, y: y, w: w, h: h,
    rectRadius: o.radius,
    fill: { color: o.fill, transparency: o.fillTransparency || 0 },
    line: { color: o.line, width: o.lineWidth },
    shadow: o.shadow ? safeOuterShadow("1F2320", 0.07, 45, 6, 1.6) : undefined
  });
}

function lineH(slide, x, y, w, color, width) {
  slide.addShape(pptx.ShapeType.line, {
    x: x, y: y, w: w, h: 0,
    line: { color: color || C.border, width: width || 0.7 }
  });
}

function arrow(slide, x, y, w, opts) {
  const o = opts || {};
  slide.addShape(pptx.ShapeType.line, {
    x: x, y: y, w: w, h: 0,
    line: {
      color: o.color || C.borderStrong,
      width: o.width || 1.2,
      endArrowType: "triangle",
      dash: o.dash || "solid"
    }
  });
}

function header(slide, eyebrow, title, subtitle) {
  accentTop(slide);
  txt(slide, eyebrow, {
    x: M, y: 0.43, w: 9.5, h: 0.22,
    fontFace: F.mono, fontSize: 8.5, color: C.primary, charSpacing: 1.8
  });
  txt(slide, title, {
    x: M, y: 0.65, w: 12.0, h: 0.5,
    fontFace: F.display, fontSize: 25, bold: true, color: C.text
  });
  let ruleY = 1.36;
  if (subtitle) {
    txt(slide, subtitle, {
      x: M, y: 1.16, w: 11.95, h: 0.26,
      fontSize: 10.2, color: C.sub
    });
    ruleY = 1.54;
  }
  lineH(slide, M, ruleY, 11.97, C.border, 0.7);
  return subtitle ? 1.74 : 1.56;
}

function footer(slide, n) {
  lineH(slide, M, 7.03, 11.97, C.border, 0.55);
  txt(slide, "PAI 个人 AI 学习 · 高保真交互原型", {
    x: M, y: 7.1, w: 6.2, h: 0.18,
    fontSize: 7.4, color: C.sub
  });
  txt(slide, String(n).padStart(2, "0") + " / " + TOTAL, {
    x: 11.35, y: 7.1, w: 1.3, h: 0.18,
    fontFace: F.mono, fontSize: 7.4, color: C.sub, align: "right", charSpacing: 1
  });
}

function chip(slide, text, x, y, w, opts) {
  const o = Object.assign({ fill: C.primarySoft, line: C.primarySoft, color: C.primary, size: 8.3 }, opts || {});
  slide.addText(text, {
    x: x, y: y, w: w, h: o.h || 0.28,
    shape: pptx.ShapeType.roundRect, rectRadius: 0.14,
    fill: { color: o.fill }, line: { color: o.line, width: 0.5 },
    fontSize: o.size, color: o.color, align: "center", valign: "mid",
    fontFace: F.body, margin: 0
  });
}

function numBadge(slide, n, x, y, size) {
  const s = size || 0.28;
  slide.addText(String(n), {
    x: x, y: y, w: s, h: s,
    shape: pptx.ShapeType.ellipse,
    fill: { color: C.primary }, line: { color: C.primary, width: 0.5 },
    fontSize: n === "AI" ? 7 : 8.2, color: C.white, align: "center", valign: "mid",
    fontFace: F.mono, bold: true, margin: 0
  });
}

function brandMark(slide, x, y, size) {
  slide.addText("PAI", {
    x: x, y: y, w: size, h: size,
    shape: pptx.ShapeType.roundRect, rectRadius: 0.07,
    fill: { color: C.primarySoft }, line: { color: C.primary, width: 0.8 },
    fontFace: F.display, fontSize: 11, bold: true, color: C.primary,
    align: "center", valign: "mid", charSpacing: 0.6, margin: 0
  });
}

function feature(slide, n, title, desc, x, y, w, opts) {
  const o = opts || {};
  numBadge(slide, n, x, y + 0.02, 0.28);
  txt(slide, title, {
    x: x + 0.4, y: y - 0.02, w: w - 0.4, h: 0.24,
    fontSize: o.titleSize || 11.6, bold: true, color: C.text
  });
  txt(slide, desc, {
    x: x + 0.4, y: y + 0.27, w: w - 0.4, h: o.descH || 0.56,
    fontSize: o.size || 9.2, color: C.sub, lineSpacingMultiple: 1.18
  });
}

function screenshot(slide, file, x, y, w, h, cropTop) {
  const img = path.join(SHOTS, file);
  slide.addShape(pptx.ShapeType.roundRect, {
    x: x - 0.07, y: y - 0.07, w: w + 0.14, h: h + 0.14,
    rectRadius: 0.08,
    fill: { color: C.white },
    line: { color: C.border, width: 0.6 },
    shadow: safeOuterShadow("1F2320", 0.12, 45, 12, 3)
  });
  const ch = cropTop || 1;
  const opt = imageSizingCrop(img, x, y, w, h, 0, 0, 1, ch);
  slide.addImage(Object.assign({ path: img }, opt));
}

function miniStat(slide, x, y, w, value, unit, label) {
  txt(slide, value, {
    x: x, y: y, w: w, h: 0.42,
    fontFace: F.display, fontSize: 21, bold: true, color: C.primary
  });
  if (unit) {
    txt(slide, unit, {
      x: x + Math.min(w - 0.2, 0.72 * String(value).length), y: y + 0.2, w: 0.45, h: 0.2,
      fontSize: 7.5, color: C.sub
    });
  }
  txt(slide, label, {
    x: x, y: y + 0.45, w: w, h: 0.22,
    fontSize: 8.2, color: C.sub
  });
}

/* ============================================================
   01 · 封面
   ============================================================ */
(function () {
  const s = pptx.addSlide();
  bg(s);
  accentTop(s);

  s.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: 0.12, h: CH,
    fill: { color: C.primary }, line: { color: C.primary, width: 0 }
  });

  // 品牌
  brandMark(s, 0.82, 1.0, 0.52);
  txt(s, "个人 AI 学习", {
    x: 1.48, y: 1.02, w: 3.2, h: 0.24,
    fontFace: F.display, fontSize: 12.5, bold: true, color: C.text
  });
  txt(s, "PERSONAL AI LEARNING", {
    x: 1.48, y: 1.27, w: 3.2, h: 0.2,
    fontFace: F.mono, fontSize: 7.2, color: C.sub, charSpacing: 1.6
  });

  txt(s, "HIGH-FIDELITY PROTOTYPE · 2026.10", {
    x: 0.82, y: 2.18, w: 6.2, h: 0.2,
    fontFace: F.mono, fontSize: 8.2, color: C.primary, charSpacing: 1.8
  });
  txt(s, "PAI 个人 AI 学习", {
    x: 0.8, y: 2.42, w: 6.1, h: 0.76,
    fontFace: F.display, fontSize: 40, bold: true, color: C.text
  });
  txt(s, "把每一次对话，\n沉淀成可复习的知识", {
    x: 0.82, y: 3.3, w: 6.0, h: 1.12,
    fontFace: F.display, fontSize: 22, color: C.primary, lineSpacingMultiple: 1.22
  });
  txt(s, "从判档讲解、六段式笔记，到学习画像与间隔复习的完整闭环；\n7 个页面常驻一个带上下文记忆的智能助手。", {
    x: 0.82, y: 4.55, w: 6.0, h: 0.8,
    fontSize: 10.4, color: C.sub, lineSpacingMultiple: 1.55
  });

  const chips = [
    ["7 个页面", 1.18],
    ["19 个概念", 1.22],
    ["12 篇笔记", 1.2],
    ["1 个全局助手", 1.52]
  ];
  let cx = 0.82;
  chips.forEach(function (it) {
    chip(s, it[0], cx, 5.62, it[1], { fill: C.surface, line: C.border, color: C.sub, size: 8.2 });
    cx += it[1] + 0.18;
  });

  txt(s, "静态高保真原型 · 数据为本地 Mock · 设计基线 PRD V1.0", {
    x: 0.82, y: 6.72, w: 6.2, h: 0.22,
    fontFace: F.mono, fontSize: 7.8, color: C.sub, charSpacing: 0.4
  });

  // 右侧页面预览
  screenshot(s, "home.png", 7.12, 1.42, 5.35, 3.34);
  txt(s, "01 · 学习概览 / 今日继续 · 学习统计 · 最近会话", {
    x: 7.12, y: 4.93, w: 5.4, h: 0.22,
    fontFace: F.mono, fontSize: 7.2, color: C.sub, charSpacing: 0.6
  });

  // 引用卡
  s.addShape(pptx.ShapeType.roundRect, {
    x: 7.12, y: 5.32, w: 5.35, h: 0.92, rectRadius: 0.08,
    fill: { color: C.surface }, line: { color: C.border, width: 0.6 }
  });
  s.addShape(pptx.ShapeType.rect, {
    x: 7.12, y: 5.42, w: 0.035, h: 0.72,
    fill: { color: C.accent }, line: { color: C.accent, width: 0 }
  });
  txt(s, "「上次停在位置编码的『相对性』这一步。\n今天从一句话直觉继续。」", {
    x: 7.34, y: 5.46, w: 4.9, h: 0.65,
    fontSize: 9.6, color: C.text, lineSpacingMultiple: 1.35, italic: true
  });
})();

/* ============================================================
   02 · 目录
   ============================================================ */
(function () {
  const s = pptx.addSlide();
  bg(s);
  const y0 = header(s, "CONTENTS · 17 PAGES", "目录", "按「先闭环、再模块、后实现与价值」的顺序阅读。");

  const items = [
    ["01", "原型概览", "产品定位、设计原则、信息架构与学习闭环", "03 – 04", C.primary],
    ["02", "模块演示", "概览 / 对话 / 笔记 / 画像 / 复习 / 设置 / 智能助手", "05 – 13", C.primary],
    ["03", "交互与技术", "五步学习闭环、技术实现亮点", "14 – 15", C.accent],
    ["04", "价值与结语", "学习者、产品验证与研发复用价值", "16 – 17", C.accent]
  ];

  items.forEach(function (it, i) {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 0.72 + col * 6.05;
    const y = 1.88 + row * 1.72;
    const w = 5.78;
    card(s, x, y, w, 1.52);
    s.addShape(pptx.ShapeType.rect, {
      x: x, y: y + 0.16, w: 0.05, h: 1.2,
      fill: { color: it[4] }, line: { color: it[4], width: 0 }
    });
    txt(s, it[0], {
      x: x + 0.24, y: y + 0.2, w: 0.8, h: 0.45,
      fontFace: F.mono, fontSize: 22, bold: true, color: it[4], charSpacing: 1
    });
    txt(s, it[1], {
      x: x + 1.12, y: y + 0.22, w: 3.6, h: 0.34,
      fontFace: F.display, fontSize: 17, bold: true, color: C.text
    });
    txt(s, it[2], {
      x: x + 1.12, y: y + 0.66, w: w - 1.4, h: 0.45,
      fontSize: 9.4, color: C.sub, lineSpacingMultiple: 1.25
    });
    txt(s, it[3], {
      x: x + w - 0.95, y: y + 1.2, w: 0.8, h: 0.18,
      fontFace: F.mono, fontSize: 8, color: C.borderStrong, align: "right"
    });
  });

  txt(s, "共 17 页 · 模块演示按用户学习路径排列 · 每页结论均可回到原型核对", {
    x: M, y: 5.95, w: 11.9, h: 0.25,
    fontSize: 8.8, color: C.sub
  });
  footer(s, 2);
})();

/* ============================================================
   03 · 产品定位与设计原则
   ============================================================ */
(function () {
  const s = pptx.addSlide();
  bg(s);
  header(s, "01 · PROTOTYPE OVERVIEW", "为「一个人的学习」设计一条闭环", "以林致远的真实学习场景为样例，原型覆盖从「今天学什么」到「下次怎么复习」的全过程。");

  // 主张
  s.addShape(pptx.ShapeType.rect, {
    x: M, y: 1.92, w: 0.05, h: 1.78,
    fill: { color: C.primary }, line: { color: C.primary, width: 0 }
  });
  txt(s, "不是更强的聊天工具，\n而是把对话、笔记、画像与复习\n串成一条可回访的学习路径。", {
    x: 0.9, y: 1.9, w: 5.6, h: 1.7,
    fontFace: F.display, fontSize: 16.5, color: C.text, lineSpacingMultiple: 1.45
  });
  txt(s, "设计出发点", {
    x: 0.9, y: 3.68, w: 2.0, h: 0.2,
    fontFace: F.mono, fontSize: 7.6, color: C.sub, charSpacing: 1.2
  });

  const facts = [
    ["46", "天", "学习旅程"],
    ["12", "天", "连续学习"],
    ["19", "个", "概念 / 12 已建档"]
  ];
  facts.forEach(function (f, i) {
    const x = 0.9 + i * 1.86;
    card(s, x, 4.08, 1.7, 1.02, { shadow: false, fill: C.surface, line: C.border });
    txt(s, f[0], {
      x: x + 0.14, y: 4.16, w: 0.5, h: 0.4,
      fontFace: F.display, fontSize: 20, bold: true, color: C.primary
    });
    txt(s, f[1], {
      x: x + 0.66, y: 4.33, w: 0.4, h: 0.2,
      fontSize: 8, color: C.sub
    });
    txt(s, f[2], {
      x: x + 0.14, y: 4.68, w: 1.45, h: 0.3,
      fontSize: 8.2, color: C.sub
    });
  });

  // 四项原则 2×2
  const rules = [
    ["01", "判档讲解", "掌握度 <0.3 / 0.3–0.7 / >0.7 对应 L0 / L1 / L2，不一次讲满。"],
    ["02", "一切可溯源", "回答可展开「为什么这么讲」；笔记有 a1–a3 锚点；画像有证据与变更记录。"],
    ["03", "纸感视觉", "米白纸感、衬线标题、低饱和绿与赭色，来自 minimal-light 学术期刊感。"],
    ["04", "本地可演示", "Mock 数据 + 零外部依赖，打开浏览器即可完整走通，不依赖后端。"]
  ];
  rules.forEach(function (r, i) {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 6.55 + col * 3.05;
    const y = 1.88 + row * 2.1;
    card(s, x, y, 2.9, 1.94, { fill: C.surface });
    txt(s, r[0], {
      x: x + 0.2, y: y + 0.17, w: 0.55, h: 0.22,
      fontFace: F.mono, fontSize: 8.4, color: C.accent, charSpacing: 1
    });
    txt(s, r[1], {
      x: x + 0.2, y: y + 0.42, w: 2.5, h: 0.3,
      fontFace: F.display, fontSize: 13.5, bold: true, color: C.text
    });
    txt(s, r[2], {
      x: x + 0.2, y: y + 0.86, w: 2.5, h: 0.92,
      fontSize: 9, color: C.sub, lineSpacingMultiple: 1.3
    });
  });

  txt(s, "设计基线 PRD V1.0 · 原型不连接真实模型 · 数据为本地 Mock", {
    x: M, y: 6.5, w: 11.9, h: 0.22,
    fontFace: F.mono, fontSize: 7.8, color: C.sub, charSpacing: 0.4
  });
  footer(s, 3);
})();

/* ============================================================
   04 · 信息架构 / 学习闭环
   ============================================================ */
(function () {
  const s = pptx.addSlide();
  bg(s);
  const y = header(s, "01 · INFORMATION ARCHITECTURE", "7 个页面，一条可回访的学习路径", "导航按学习阶段组织；全局智能助手在任意页面携带上下文出现。");

  const nodes = [
    ["01", "学习概览", "今日继续 / 统计\n待复习 / 画像快照"],
    ["02", "对话讲解", "判档讲解 / 反馈\nToken 预算"],
    ["03", "笔记库", "六段式笔记\n锚点溯源 / 合并"],
    ["04", "学习画像", "掌握度 / 证据\n手动纠错保护"],
    ["05", "复习队列", "间隔重复 / 自评\n结果回流画像"]
  ];
  const x0 = 0.72, gap = 0.3, w = 2.12;
  nodes.forEach(function (n, i) {
    const x = x0 + i * (w + gap);
    card(s, x, 1.86, w, 1.62, { fill: C.surface });
    txt(s, n[0], {
      x: x + 0.16, y: 1.96, w: 0.5, h: 0.2,
      fontFace: F.mono, fontSize: 7.8, color: C.accent, charSpacing: 1
    });
    txt(s, n[1], {
      x: x + 0.16, y: 2.2, w: w - 0.3, h: 0.3,
      fontFace: F.display, fontSize: 14.5, bold: true, color: C.text
    });
    txt(s, n[2], {
      x: x + 0.16, y: 2.63, w: w - 0.3, h: 0.72,
      fontSize: 8.7, color: C.sub, lineSpacingMultiple: 1.3
    });
    if (i < nodes.length - 1) {
      arrow(s, x + w + 0.03, 2.68, gap - 0.06, { color: C.borderStrong, width: 1.1 });
    }
  });

  // 回流箭头（复习队列 → 学习概览）
  s.addShape(pptx.ShapeType.line, {
    x: 12.16, y: 3.48, w: 0, h: 0.54,
    line: { color: C.accent, width: 1.1 }
  });
  s.addShape(pptx.ShapeType.line, {
    x: 1.86, y: 4.02, w: 10.3, h: 0,
    line: { color: C.accent, width: 1.1 }
  });
  s.addShape(pptx.ShapeType.line, {
    x: 1.86, y: 3.48, w: 0, h: 0.54,
    line: { color: C.accent, width: 1.1, beginArrowType: "triangle" }
  });
  txt(s, "复习结果回流：掌握度、到期时间与今日任务", {
    x: 3.0, y: 3.7, w: 5.4, h: 0.22,
    fontFace: F.mono, fontSize: 7.4, color: C.accent, charSpacing: 0.4
  });

  // 设置 + 助手
  card(s, 0.72, 4.5, 2.14, 1.0, { fill: C.surfaceAlt, shadow: false });
  txt(s, "设置", {
    x: 0.88, y: 4.58, w: 1.0, h: 0.26,
    fontFace: F.display, fontSize: 12, bold: true, color: C.text
  });
  txt(s, "服务商 / 人格 / 预算 / 数据", {
    x: 0.88, y: 4.88, w: 1.8, h: 0.4,
    fontSize: 8, color: C.sub, lineSpacingMultiple: 1.2
  });

  card(s, 3.2, 4.5, 9.48, 1.0, { fill: C.primarySoft, line: C.primarySoft, shadow: false });
  txt(s, "全局智能助手 · 7 页常驻", {
    x: 3.4, y: 4.58, w: 3.3, h: 0.26,
    fontFace: F.display, fontSize: 12, bold: true, color: C.primary
  });
  txt(s, "自然语言对话 / 9 条指令 / 上下文记忆 / 流式响应 / 三档响应式", {
    x: 3.4, y: 4.9, w: 7.0, h: 0.28,
    fontSize: 8.5, color: C.primaryHover
  });
  numBadge(s, "AI", 11.85, 4.68, 0.52);

  // 数据规模
  const stats = [
    ["8", "条历史会话"],
    ["12", "篇结构化笔记"],
    ["12 / 19", "已建档 / 全量概念"],
    ["10", "条复习排期"]
  ];
  stats.forEach(function (st, i) {
    const x = 0.72 + i * 3.02;
    txt(s, st[0], {
      x: x, y: 5.82, w: 1.7, h: 0.4,
      fontFace: F.display, fontSize: 19, bold: true, color: C.primary
    });
    txt(s, st[1], {
      x: x, y: 6.24, w: 2.2, h: 0.22,
      fontSize: 8.2, color: C.sub
    });
  });

  footer(s, 4);
})();

/* ============================================================
   05 · 学习概览
   ============================================================ */
(function () {
  const s = pptx.addSlide();
  bg(s);
  header(s, "02 · MODULE / 学习概览", "学习概览：今天该做什么，一眼看清", "所有入口都围绕「继续上次的进度」，并把复习、笔记与画像集中到首屏。");

  screenshot(s, "home.png", 0.7, 1.72, 7.95, 4.97);

  const fx = 8.95, fw = 3.72;
  feature(s, 1, "今日继续", "上次停在位置编码的「相对性」；L2 深入、24 条消息、画像已更新。两个 CTA 直达会话与对应笔记。", fx, 1.76, fw);
  feature(s, 2, "复习与画像双入口", "4 个概念今日到期；画像快照直接列出掌握度最低的 5 个概念，点击即可进入复习或画像。", fx, 2.98, fw);
  feature(s, 3, "节奏可视化", "连续 12 天、7/19 已掌握、65 分钟/天；周柱状图标注周四空白日，建议补一次 15 分钟复习。", fx, 4.2, fw);

  s.addShape(pptx.ShapeType.roundRect, {
    x: fx, y: 5.55, w: fw, h: 1.0, rectRadius: 0.08,
    fill: { color: C.accentSoft }, line: { color: C.accentSoft, width: 0.5 }
  });
  txt(s, "5.1 小时", {
    x: fx + 0.18, y: 5.64, w: 1.65, h: 0.36,
    fontFace: F.display, fontSize: 18, bold: true, color: C.accent
  });
  txt(s, "本周学习 · 12 篇笔记", {
    x: fx + 0.18, y: 6.07, w: 1.8, h: 0.22,
    fontSize: 8.2, color: C.accent
  });
  txt(s, "从空白日回到节奏里", {
    x: fx + 2.08, y: 5.78, w: 1.42, h: 0.5,
    fontSize: 8.4, color: C.sub, lineSpacingMultiple: 1.2
  });

  footer(s, 5);
})();

/* ============================================================
   06 · 对话讲解
   ============================================================ */
(function () {
  const s = pptx.addSlide();
  bg(s);
  header(s, "02 · MODULE / 对话讲解", "对话讲解：一条会自我校准的讲解线程", "回答头部标注深度，尾部提供反馈与判档解释；输入区随时继续追问。");

  screenshot(s, "chat.png", 0.7, 1.72, 7.95, 4.97);

  const fx = 8.95, fw = 3.72;
  feature(s, 1, "回答自带判档标签", "当前 L2 深入；同一条线程里会出现 L1 中等、L0 基础，深度随掌握度变化。", fx, 1.76, fw);
  feature(s, 2, "五类反馈动作", "有帮助 / 太浅 / 没懂 / 更简单的说法 / 为什么这么讲，反馈直接写入画像。", fx, 2.89, fw);
  feature(s, 3, "编辑与重生成", "修改提问或重生成回答后，紧随其后的旧回答会标记「已过期」，可继续重答。", fx, 4.02, fw);
  feature(s, 4, "输入区与预算", "建议 chips 一键带入；Enter 发送、Shift+Enter 换行；Token 预算 32,000，达到 80% 自动压缩历史。", fx, 5.15, fw);

  footer(s, 6);
})();

/* ============================================================
   07 · 判档与反馈机制
   ============================================================ */
(function () {
  const s = pptx.addSlide();
  bg(s);
  header(s, "02 · MODULE / 判档机制", "先判断你懂到哪，再决定讲多深", "掌握度阈值 0.3 / 0.7 来自学习画像；同一问题在不同掌握度下会得到不同深度的回答。");

  const levels = [
    ["L0", "基础", "< 0.3", "单一类比，暂不引入新符号与公式。", "位置编码只旋转指针，不改变长度。"],
    ["L1", "中等", "0.3 – 0.7", "先给结论，再补一条原理，不展开完整推导。", "自注意力看得见所有词，却看不见顺序。"],
    ["L2", "深入", "> 0.7", "补充公式、方案对比与长序列外推。", "⟨R(θi)q, R(θj)k⟩ = f(q, k, i − j)"]
  ];
  levels.forEach(function (lv, i) {
    const x = 0.72 + i * 4.05;
    const y = 1.92;
    card(s, x, y, 3.82, 2.18, { fill: i === 2 ? C.primarySoft : C.surface, line: i === 2 ? C.primarySoft : C.border });
    txt(s, lv[0], {
      x: x + 0.24, y: y + 0.18, w: 0.72, h: 0.46,
      fontFace: F.display, fontSize: 26, bold: true, color: i === 2 ? C.primary : C.text
    });
    txt(s, lv[1], {
      x: x + 1.02, y: y + 0.24, w: 1.2, h: 0.3,
      fontFace: F.display, fontSize: 13, bold: true, color: C.text
    });
    chip(s, lv[2], x + 2.3, y + 0.24, 1.28, { fill: C.surface, line: C.border, color: C.sub, size: 7.6 });
    txt(s, lv[3], {
      x: x + 0.24, y: y + 0.88, w: 3.34, h: 0.6,
      fontSize: 9.1, color: C.sub, lineSpacingMultiple: 1.28
    });
    txt(s, lv[4], {
      x: x + 0.24, y: y + 1.55, w: 3.34, h: 0.42,
      fontSize: 8.6, color: C.primary, lineSpacingMultiple: 1.2
    });
    if (i < 2) arrow(s, x + 3.87, y + 1.02, 0.14, { color: C.borderStrong, width: 1.2 });
  });

  txt(s, "反馈如何改变下一次讲解", {
    x: M, y: 4.36, w: 5.0, h: 0.28,
    fontFace: F.display, fontSize: 13, bold: true, color: C.text
  });
  txt(s, "每一次反馈都会写入画像，并影响下一次判档", {
    x: 6.0, y: 4.41, w: 6.5, h: 0.22,
    fontSize: 8.2, color: C.sub
  });

  const signals = [
    ["有帮助 / 没懂", "±0.15；单轮最多记录一次负向信号，「没懂」会触发降档。"],
    ["太浅", "记录一次负向信号，下一次讲解主动加深。"],
    ["手动纠错", "优先级最高，直接覆盖系统估值，并锁 30 天保护期。"],
    ["追问质量", "主动比较方案、使用关键限定词，可上调掌握度并进入 L2。"]
  ];
  signals.forEach(function (sg, i) {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 0.72 + col * 6.05;
    const y = 4.74 + row * 0.86;
    card(s, x, y, 5.76, 0.74, { fill: C.surface, shadow: false });
    numBadge(s, i + 1, x + 0.18, y + 0.22, 0.26);
    txt(s, sg[0], {
      x: x + 0.55, y: y + 0.14, w: 1.45, h: 0.22,
      fontSize: 9.3, bold: true, color: C.text
    });
    txt(s, sg[1], {
      x: x + 0.55, y: y + 0.4, w: 5.0, h: 0.26,
      fontSize: 8.2, color: C.sub
    });
  });

  footer(s, 7);
})();

/* ============================================================
   08 · 笔记库
   ============================================================ */
(function () {
  const s = pptx.addSlide();
  bg(s);
  header(s, "02 · MODULE / 笔记库", "笔记库：把对话沉淀成可检索的知识卡片", "12 篇笔记 · 5 个领域 · 置顶 2 篇；搜索同时匹配标题、摘要、标签与概念。");

  screenshot(s, "notes.png", 0.7, 1.72, 7.55, 4.72);

  const fx = 8.55, fw = 4.1;
  const stats = [
    ["12", "篇笔记"],
    ["11", "已归类"],
    ["2", "置顶"]
  ];  stats.forEach(function (st, i) {
    const x = fx + i * 1.36;
    txt(s, st[0], {
      x: x, y: 1.72, w: 1.2, h: 0.4,
      fontFace: F.display, fontSize: 19, bold: true, color: C.primary
    });
    txt(s, st[1], {
      x: x, y: 2.12, w: 1.2, h: 0.2,
      fontSize: 8, color: C.sub
    });
  });

  feature(s, 1, "检索与筛选", "300ms 防抖搜索、领域 chips、三种排序方式。", fx, 2.52, fw);
  feature(s, 2, "卡片信息完整", "领域、置顶、字数、草稿 / 已导出状态、更新时间一屏可见；12 篇完整渲染。", fx, 3.62, fw);
  feature(s, 3, "批量合并为总纲", "勾选至少 2 篇同领域笔记，生成可溯源总纲；原笔记保留，只影响展示。", fx, 4.72, fw);

  s.addShape(pptx.ShapeType.roundRect, {
    x: fx, y: 5.82, w: fw, h: 0.62, rectRadius: 0.08,
    fill: { color: C.accentSoft }, line: { color: C.accentSoft, width: 0.5 }
  });
  txt(s, "新建笔记同样进入复习队列；空状态可一键清除筛选。", {
    x: fx + 0.18, y: 5.97, w: fw - 0.34, h: 0.32,
    fontSize: 8.2, color: C.accent
  });

  footer(s, 8);
})();

/* ============================================================
   09 · 笔记阅读
   ============================================================ */
(function () {
  const s = pptx.addSlide();
  bg(s);
  header(s, "02 · MODULE / 笔记阅读", "笔记阅读：六段式结构，每句话都能回到原对话", "6 节正文 · 3 个溯源锚点 · 4 条术语 · 5 张复习卡片。");

  screenshot(s, "note.png", 0.7, 1.72, 7.2, 4.5);

  const rx = 8.18, rw = 4.47;
  txt(s, "六段式结构", {
    x: rx, y: 1.72, w: 2.6, h: 0.26,
    fontFace: F.display, fontSize: 12.5, bold: true, color: C.text
  });
  const sections = ["概念定义", "直觉类比", "数学形式", "代码对应", "常见误区", "自检问题"];
  sections.forEach(function (name, i) {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = rx + col * 2.25;
    const y = 2.06 + row * 0.52;
    s.addShape(pptx.ShapeType.roundRect, {
      x: x, y: y, w: 2.1, h: 0.42, rectRadius: 0.06,
      fill: { color: C.surfaceAlt }, line: { color: C.border, width: 0.4 }
    });
    txt(s, "0" + (i + 1), {
      x: x + 0.1, y: y, w: 0.32, h: 0.42,
      fontFace: F.mono, fontSize: 7.2, color: C.accent, valign: "mid"
    });
    txt(s, name, {
      x: x + 0.42, y: y, w: 1.55, h: 0.42,
      fontSize: 8.8, color: C.text, valign: "mid"
    });
  });

  feature(s, 1, "锚点 a1–a3", "点击正文锚点，浮层展示原对话原句与时间，并可直接回到会话。", rx, 3.72, rw, { size: 8.8 });
  feature(s, 2, "术语表与复习卡片", "4 条术语可追加；5 张卡片点击翻面，答案直接来自笔记。", rx, 4.58, rw, { size: 8.8 });
  feature(s, 3, "三种出口", "导出 Markdown / 加入复习 / 编辑，保留来源与锚点信息。", rx, 5.44, rw, { size: 8.8 });

  footer(s, 9);
})();

/* ============================================================
   10 · 学习画像
   ============================================================ */
(function () {
  const s = pptx.addSlide();
  bg(s);
  header(s, "02 · MODULE / 学习画像", "学习画像：把「我感觉懂了」变成可解释的掌握度", "平均 0.45 · 7/19 已掌握 · 1 条 30 天保护期；每次变更都留痕。");

  screenshot(s, "profile.png", 0.7, 1.72, 7.9, 4.94);

  const fx = 8.9, fw = 3.78;
  const stats = [
    ["0.45", "平均掌握度"],
    ["7 / 19", "已掌握"],
    ["1", "保护期条目"]
  ];
  stats.forEach(function (st, i) {
    const x = fx + i * 1.3;
    txt(s, st[0], {
      x: x, y: 1.72, w: 1.2, h: 0.4,
      fontFace: F.display, fontSize: i === 1 ? 16 : 20, bold: true, color: C.primary
    });
    txt(s, st[1], {
      x: x, y: 2.12, w: 1.2, h: 0.2,
      fontSize: 7.8, color: C.sub
    });
  });

  const signals = [
    ["提问", "首次提问建立条目，初始 0.3"],
    ["反馈", "有帮助 +0.15，没懂 −0.15"],
    ["手动纠错", "优先级最高，锁 30 天保护期"],
    ["时间衰减", "连续 90 天未复习记 −0.1"]
  ];
  signals.forEach(function (sg, i) {
    const y = 2.55 + i * 0.72;
    s.addShape(pptx.ShapeType.roundRect, {
      x: fx, y: y, w: fw, h: 0.6, rectRadius: 0.06,
      fill: { color: C.surfaceAlt }, line: { color: C.border, width: 0.4 }
    });
    txt(s, sg[0], {
      x: fx + 0.16, y: y + 0.14, w: 1.05, h: 0.22,
      fontSize: 9.2, bold: true, color: C.text
    });
    txt(s, sg[1], {
      x: fx + 1.28, y: y + 0.14, w: 2.4, h: 0.22,
      fontSize: 8, color: C.sub
    });
  });

  feature(s, 1, "证据与纠错都可追溯", "点开「证据」查看原对话引用与时间；手动纠错进入 30 天保护期；最近变更 timeline 记录每次信号来源。", fx, 5.42, fw, { size: 8.6, descH: 0.9 });

  footer(s, 10);
})();

/* ============================================================
   11 · 复习队列
   ============================================================ */
(function () {
  const s = pptx.addSlide();
  bg(s);
  header(s, "02 · MODULE / 复习队列", "复习队列：按间隔重复，把「学过」变成「记住」", "今日 4 个到期 · 明天 3 个 · 本周 10 个；预计 8 分钟完成。");

  screenshot(s, "review.png", 0.7, 1.72, 7.9, 4.94);

  const fx = 8.9, fw = 3.78;
  const stats = [
    ["4", "今日到期"],
    ["3", "明天"],
    ["10", "本周计划"]
  ];
  stats.forEach(function (st, i) {
    const x = fx + i * 1.28;
    txt(s, st[0], {
      x: x, y: 1.7, w: 1.15, h: 0.4,
      fontFace: F.display, fontSize: 21, bold: true, color: C.primary
    });
    txt(s, st[1], {
      x: x, y: 2.1, w: 1.2, h: 0.2,
      fontSize: 7.8, color: C.sub
    });
  });

  const rules = [
    ["认识了", "间隔 ×1.5：当前 4 天，下一次约 6 天后。", C.primary, C.primarySoft],
    ["还不熟", "间隔回到 2 天，明天优先出现在队列。", C.danger, "F9E9E6"]
  ];
  rules.forEach(function (r, i) {
    const x = fx + i * 1.94;
    s.addShape(pptx.ShapeType.roundRect, {
      x: x, y: 2.5, w: 1.84, h: 1.22, rectRadius: 0.07,
      fill: { color: r[3] }, line: { color: r[3], width: 0.5 }
    });
    txt(s, r[0], {
      x: x + 0.16, y: 2.62, w: 1.2, h: 0.24,
      fontSize: 9.6, bold: true, color: r[2]
    });
    txt(s, r[1], {
      x: x + 0.16, y: 2.92, w: 1.52, h: 0.7,
      fontSize: 8, color: C.sub, lineSpacingMultiple: 1.3
    });
  });

  txt(s, "复习不是重读，而是四步自评", {
    x: fx, y: 3.96, w: 3.6, h: 0.24,
    fontFace: F.display, fontSize: 11.5, bold: true, color: C.text
  });
  const steps = ["到期卡片：来源笔记 + 间隔", "先在心里回答", "揭示答案，对照要点", "认识了 / 还不熟 → 回流画像"];
  steps.forEach(function (st, i) {
    const y = 4.28 + i * 0.42;
    numBadge(s, i + 1, fx, y + 0.02, 0.24);
    txt(s, st, {
      x: fx + 0.36, y: y, w: fw - 0.36, h: 0.3,
      fontSize: 8.4, color: C.sub, valign: "mid"
    });
  });

  s.addShape(pptx.ShapeType.roundRect, {
    x: fx, y: 6.05, w: fw, h: 0.55, rectRadius: 0.06,
    fill: { color: C.accentSoft }, line: { color: C.accentSoft, width: 0.4 }
  });
  txt(s, "评分写入画像：认识记一次应用证据，不熟记一次负向信号。", {
    x: fx + 0.14, y: 6.15, w: fw - 0.28, h: 0.35,
    fontSize: 7.8, color: C.accent, lineSpacingMultiple: 1.2
  });

  footer(s, 11);
})();

/* ============================================================
   12 · 设置
   ============================================================ */
(function () {
  const s = pptx.addSlide();
  bg(s);
  header(s, "02 · MODULE / 设置", "设置：AI 服务、讲解偏好与数据控制集中在一处", "当前：DeepSeek · deepseek-chat · 32,000 tokens；保存即生效。");

  screenshot(s, "settings.png", 0.7, 1.72, 7.55, 4.72);

  const fx = 8.55, fw = 4.1;
  const groups = [
    ["AI 服务", "5 个服务商：智谱 GLM / DeepSeek / Kimi / OpenAI / 自定义；模型随服务商联动；Key 仅保存在本地，可显示隐藏并测试连接。"],
    ["讲解偏好", "4 种导师人格：通用讲解 / 苏格拉底 / 教练 / 极简；预算 8,000–64,000 tokens（4,000 步进）；达到 80% 自动压缩历史。"],
    ["通知与数据", "完成通知开关；导出全部数据为 JSON；清除本地数据需输入「清除」二次确认。"]
  ];
  groups.forEach(function (g, i) {
    const y = 1.78 + i * 1.52;
    card(s, fx, y, fw, 1.36, { fill: C.surface, shadow: false });
    txt(s, "0" + (i + 1), {
      x: fx + 0.18, y: y + 0.15, w: 0.3, h: 0.2,
      fontFace: F.mono, fontSize: 7.8, color: C.accent
    });
    txt(s, g[0], {
      x: fx + 0.55, y: y + 0.12, w: 2.6, h: 0.26,
      fontFace: F.display, fontSize: 12.5, bold: true, color: C.text
    });
    txt(s, g[1], {
      x: fx + 0.18, y: y + 0.48, w: fw - 0.36, h: 0.76,
      fontSize: 8.2, color: C.sub, lineSpacingMultiple: 1.3
    });
  });

  footer(s, 12);
})();

/* ============================================================
   13 · 智能助手
   ============================================================ */
(function () {
  const s = pptx.addSlide();
  bg(s);
  header(s, "02 · MODULE / 智能助手", "智能助手：7 个页面常驻的学习副驾驶", "类 Grok Bot 的浮层对话：自然语言、流式响应、快捷指令与跨页上下文记忆。");

  screenshot(s, "assistant.png", 0.7, 1.72, 7.4, 4.63);

  const fx = 8.45, fw = 4.2;
  feature(s, 1, "全局唤起", "右下角入口 / Alt+A；Esc 收起；对话讲解页自动收为圆形并避让输入区。", fx, 1.72, fw, { size: 8.4, descH: 0.5 });
  feature(s, 2, "实时响应", "思考中 → 3 字 / 18ms 流式 → 可停止；支持复制、重新生成与新对话。", fx, 2.58, fw, { size: 8.4, descH: 0.5 });
  feature(s, 3, "快捷指令", "6 个常驻快捷指令 + 9 个 / 斜杠指令；↑↓ 选择、Enter 执行。", fx, 3.44, fw, { size: 8.4, descH: 0.5 });
  feature(s, 4, "上下文记忆", "页面 / 概念 / 话题三类标签；跨页面保留，回答尾部标注引用来源。", fx, 4.3, fw, { size: 8.4, descH: 0.5 });
  feature(s, 5, "三档响应式", "桌面浮层 / 平板 400px 贴边 / 手机全屏并锁定背景滚动。", fx, 5.16, fw, { size: 8.4, descH: 0.5 });

  s.addShape(pptx.ShapeType.roundRect, {
    x: fx, y: 5.98, w: fw, h: 0.62, rectRadius: 0.08,
    fill: { color: C.primarySoft }, line: { color: C.primarySoft, width: 0.5 }
  });
  txt(s, "/explain  /quiz  /review  /compare  /plan  …", {
    x: fx + 0.16, y: 6.15, w: fw - 0.32, h: 0.26,
    fontFace: F.mono, fontSize: 8.2, color: C.primary, align: "center"
  });

  footer(s, 13);
})();

/* ============================================================
   14 · 交互逻辑
   ============================================================ */
(function () {
  const s = pptx.addSlide();
  bg(s);
  header(s, "03 · INTERACTION LOGIC", "一次提问，如何走完学习闭环", "每个动作都有下一步：反馈改变深度，笔记保留来源，复习结果回流画像。");

  const flow = [
    ["01", "提问", "从概览或对话页发起，形成会话与概念条目。"],
    ["02", "判档回答", "按掌握度选 L0 / L1 / L2，附「为什么这么讲」。"],
    ["03", "反馈与追问", "有帮助 / 没懂 / 太浅；编辑或重生成标记过期。"],
    ["04", "整理笔记", "六段式 + a1–a3 锚点，来源随时可回查。"],
    ["05", "复习回流", "自评更新间隔与画像，回到今日队列。"]
  ];
  const w = 2.03, gap = 0.36, x0 = 0.72;
  flow.forEach(function (f, i) {
    const x = x0 + i * (w + gap);
    card(s, x, 1.9, w, 1.98, { fill: i === 4 ? C.primarySoft : C.surface, line: i === 4 ? C.primarySoft : C.border });
    txt(s, f[0], {
      x: x + 0.18, y: 2.0, w: 0.5, h: 0.22,
      fontFace: F.mono, fontSize: 8, color: C.accent
    });
    txt(s, f[1], {
      x: x + 0.18, y: 2.26, w: w - 0.3, h: 0.3,
      fontFace: F.display, fontSize: 13.5, bold: true, color: C.text
    });
    txt(s, f[2], {
      x: x + 0.18, y: 2.7, w: w - 0.32, h: 0.95,
      fontSize: 8.3, color: C.sub, lineSpacingMultiple: 1.25
    });
    if (i < 4) arrow(s, x + w + 0.05, 2.9, gap - 0.1, { color: C.borderStrong, width: 1.2 });
  });

  txt(s, "分支：同一动作在不同结果下的去向", {
    x: M, y: 4.14, w: 6.4, h: 0.25,
    fontFace: F.display, fontSize: 11.8, bold: true, color: C.text
  });

  const branches = [
    ["没懂", "降档 + 负向信号", "下一轮降到最小必要深度"],
    ["编辑 / 重生成", "旧回答标记过期", "重新生成一版更短的解释"],
    ["点击锚点", "原句与时间", "回到会话核对来源"],
    ["复习评分", "间隔 ×1.5 / 回 2 天", "同时写入画像证据"]
  ];
  branches.forEach(function (b, i) {
    const x = 0.72 + i * 3.0;
    card(s, x, 4.48, 2.84, 1.18, { fill: C.surface, shadow: false });
    txt(s, b[0], {
      x: x + 0.16, y: 4.58, w: 2.5, h: 0.24,
      fontSize: 9.8, bold: true, color: C.primary
    });
    txt(s, b[1], {
      x: x + 0.16, y: 4.87, w: 2.55, h: 0.22,
      fontSize: 8.4, color: C.text
    });
    txt(s, b[2], {
      x: x + 0.16, y: 5.12, w: 2.55, h: 0.38,
      fontSize: 7.8, color: C.sub, lineSpacingMultiple: 1.15
    });
  });

  s.addShape(pptx.ShapeType.roundRect, {
    x: 0.72, y: 5.94, w: 11.94, h: 0.58, rectRadius: 0.07,
    fill: { color: C.primarySoft }, line: { color: C.primarySoft, width: 0.5 }
  });
  txt(s, "闭环回到学习概览：今日继续、待复习、画像快照全部来自同一条数据链。", {
    x: 0.92, y: 6.13, w: 11.4, h: 0.24,
    fontSize: 9.2, color: C.primary
  });

  footer(s, 14);
})();

/* ============================================================
   15 · 技术实现
   ============================================================ */
(function () {
  const s = pptx.addSlide();
  bg(s);
  header(s, "03 · ENGINEERING", "技术实现：用最少依赖，把交互做完整", "7 个静态页面 + 共享外壳 + Mock 服务层；无需构建工具，打开浏览器即可运行。");

  const cards = [
    ["01", "静态多页外壳", "app.js 统一处理导航激活、toast、弹窗、下载；7 个页面共享同一套外壳。", "shared shell"],
    ["02", "单一 Mock 数据源", "mock.js 提供全站数据；api.js 接口统一 async + delay。", "mock → api"],
    ["03", "零外部依赖", "Lucide 图标以内联 SVG 实现，可完全离线运行，无 CDN 与框架依赖。", "inline svg"],
    ["04", "状态与竞态", "防抖搜索 + 请求序号；删除二次确认；5 秒撤销。", "race-safe"],
    ["05", "智能助手", "流式渲染、上下文持久化、动态避让与三档响应式。", "streaming"],
    ["06", "可访问性", "aria-label / role、键盘操作、Esc 关闭、减少动效。", "a11y"]
  ];
  cards.forEach(function (c, i) {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = 0.72 + col * 3.96;
    const y = 1.82 + row * 2.02;
    card(s, x, y, 3.78, 1.86, { fill: C.surface });
    txt(s, c[0], {
      x: x + 0.2, y: y + 0.15, w: 0.45, h: 0.2,
      fontFace: F.mono, fontSize: 8, color: C.accent
    });
    txt(s, c[1], {
      x: x + 0.2, y: y + 0.4, w: 3.35, h: 0.28,
      fontFace: F.display, fontSize: 12.5, bold: true, color: C.text
    });
    txt(s, c[2], {
      x: x + 0.2, y: y + 0.82, w: 3.35, h: 0.78,
      fontSize: 8.3, color: C.sub, lineSpacingMultiple: 1.3
    });
    txt(s, c[3], {
      x: x + 0.2, y: y + 1.62, w: 3.3, h: 0.18,
      fontFace: F.mono, fontSize: 6.8, color: C.borderStrong, charSpacing: 1
    });
  });

  s.addShape(pptx.ShapeType.roundRect, {
    x: 0.72, y: 6.05, w: 7.35, h: 0.6, rectRadius: 0.06,
    fill: { color: "232B27" }, line: { color: "232B27", width: 0.5 }
  });
  txt(s, "api.getNotes({ query, domain, sort }) → Promise<Note[]>", {
    x: 0.9, y: 6.19, w: 7.0, h: 0.26,
    fontFace: F.mono, fontSize: 7.8, color: "E7ECDD"
  });
  txt(s, "替换 api.js 函数体即可接真实后端，页面无需改动。", {
    x: 8.3, y: 6.2, w: 4.3, h: 0.26,
    fontSize: 8.2, color: C.sub
  });

  footer(s, 15);
})();

/* ============================================================
   16 · 价值收益
   ============================================================ */
(function () {
  const s = pptx.addSlide();
  bg(s);
  header(s, "04 · VALUE", "价值：把学习行为串成闭环，而不是堆功能", "从学习者、产品验证与研发复用三个视角看这套原型。");

  const cols = [
    ["学习者", "让每一次学习都留下下一步", [
      "讲解有依据：回答自带判档标签与「为什么这么讲」。",
      "知识有落点：六段式笔记 + 锚点，随时回到原句。",
      "复习有节奏：今日到期、间隔重复、评分回流画像。"
    ], C.primary, C.primarySoft],
    ["产品验证", "在写后端之前，先把产品逻辑跑一遍", [
      "高保真可点击：7 个页面与核心流程完整可演示。",
      "核心假设可测：判档、反馈、画像、复习是否成立。",
      "零环境门槛：本地 Mock，打开浏览器即可试用。"
    ], C.accent, C.accentSoft],
    ["研发复用", "把设计契约变成可延展的工程底座", [
      "设计令牌 + 共享外壳：新页面直接复用现有语言。",
      "Mock → 真实 API：替换 api.js 函数体即可切换。",
      "助手独立增量接入：一个 CSS + 一个 JS，不改旧逻辑。"
    ], C.primaryHover, "E3ECE8"]
  ];

  cols.forEach(function (col, i) {
    const x = 0.72 + i * 4.04;
    card(s, x, 1.86, 3.82, 3.98, { fill: C.surface });
    s.addShape(pptx.ShapeType.rect, {
      x: x + 0.24, y: 2.06, w: 0.05, h: 0.42,
      fill: { color: col[3] }, line: { color: col[3], width: 0 }
    });
    txt(s, col[0], {
      x: x + 0.42, y: 2.06, w: 2.6, h: 0.32,
      fontFace: F.display, fontSize: 16, bold: true, color: col[3]
    });
    txt(s, col[1], {
      x: x + 0.24, y: 2.5, w: 3.35, h: 0.5,
      fontSize: 8.8, color: C.sub, lineSpacingMultiple: 1.25
    });
    col[2].forEach(function (item, j) {
      const y = 3.12 + j * 0.8;
      numBadge(s, j + 1, x + 0.24, y + 0.02, 0.24);
      txt(s, item, {
        x: x + 0.6, y: y, w: 3.0, h: 0.52,
        fontSize: 8.6, color: C.text, lineSpacingMultiple: 1.25
      });
    });
  });

  s.addShape(pptx.ShapeType.roundRect, {
    x: 0.72, y: 6.08, w: 11.94, h: 0.58, rectRadius: 0.07,
    fill: { color: C.surfaceAlt }, line: { color: C.surfaceAlt, width: 0.5 }
  });
  txt(s, "原型不是最终产品，而是把产品逻辑先跑一遍的低成本验证载体。", {
    x: 0.92, y: 6.25, w: 11.5, h: 0.24,
    fontFace: F.display, fontSize: 11, color: C.text
  });

  footer(s, 16);
})();

/* ============================================================
   17 · 结束页
   ============================================================ */
(function () {
  const s = pptx.addSlide();
  bg(s);
  accentTop(s);
  s.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: 0.12, h: CH,
    fill: { color: C.primary }, line: { color: C.primary, width: 0 }
  });

  brandMark(s, 0.82, 0.94, 0.52);
  txt(s, "个人 AI 学习 / Personal AI Learning", {
    x: 1.48, y: 1.08, w: 4.8, h: 0.24,
    fontSize: 9.2, color: C.sub
  });

  txt(s, "THANK YOU", {
    x: 0.82, y: 2.15, w: 5.0, h: 0.22,
    fontFace: F.mono, fontSize: 8.6, color: C.primary, charSpacing: 2.4
  });
  txt(s, "谢谢观看", {
    x: 0.8, y: 2.45, w: 6.2, h: 0.9,
    fontFace: F.display, fontSize: 44, bold: true, color: C.text
  });
  txt(s, "从对话开始，把知识留下来。", {
    x: 0.82, y: 3.5, w: 6.2, h: 0.42,
    fontFace: F.display, fontSize: 17, color: C.primary
  });
  txt(s, "PAI 个人 AI 学习 · 高保真交互原型", {
    x: 0.82, y: 4.18, w: 5.6, h: 0.26,
    fontSize: 10.2, color: C.sub
  });

  const chips = [
    ["7 个页面", 1.18],
    ["9 条助手指令", 1.48],
    ["1 条学习闭环", 1.58]
  ];
  let cx = 0.82;
  chips.forEach(function (it) {
    chip(s, it[0], cx, 5.05, it[1], { fill: C.surface, line: C.border, color: C.sub, size: 8.2 });
    cx += it[1] + 0.18;
  });

  txt(s, "2026.10 · 数据为本地 Mock · 不连接真实模型", {
    x: 0.82, y: 6.72, w: 6.2, h: 0.22,
    fontFace: F.mono, fontSize: 7.8, color: C.sub, charSpacing: 0.4
  });

  // 右侧大字水印
  txt(s, "PAI", {
    x: 7.12, y: 1.65, w: 5.6, h: 3.4,
    fontFace: F.display, fontSize: 150, bold: true, color: C.primarySoft,
    align: "right", valign: "mid", charSpacing: 3
  });
  lineH(s, 7.0, 5.2, 5.7, C.border, 0.7);
  txt(s, "学习概览 · 对话讲解 · 笔记库 · 学习画像 · 复习队列 · 设置 · 智能助手", {
    x: 7.0, y: 5.35, w: 5.7, h: 0.24,
    fontFace: F.mono, fontSize: 7.2, color: C.sub, align: "right", charSpacing: 0.4
  });
})();

/* ---------------------------- 输出与检查 ---------------------------- */
// 输出前检查：所有文本 run 的颜色必须为字符串
pptx._slides.forEach(function (slide, si) {
  slide._slideObjects.forEach(function (obj, oi) {
    const o = obj.options || {};
    if (o.color && typeof o.color !== "string") console.log("BAD OPTION COLOR", si, oi, o.color);
    if (Array.isArray(obj.text)) {
      obj.text.forEach(function (run, ri) {
        if (run.options && run.options.color && typeof run.options.color !== "string") {
          console.log("BAD RUN COLOR", si, oi, ri, run.options.color);
        }
      });
    }
  });
});

pptx._slides.forEach(function (s, i) {
  warnIfSlideHasOverlaps(s, pptx, { ignoreDecorativeShapes: true, ignoreLines: true });
  warnIfSlideElementsOutOfBounds(s, pptx);
});

pptx.writeFile({ fileName: OUT }).then(function () {
  console.log("WROTE", OUT);
}).catch(function (e) {
  console.error("WRITE FAILED", e);
  process.exit(1);
});
