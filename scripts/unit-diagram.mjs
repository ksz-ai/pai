// 边界用例：spec.ts 校验器 + markdown.ts 围栏处理（Node 24 type stripping 直接 import，无依赖）
// 运行：node scripts/unit-diagram.mjs（type-stripping 警告无害）
import { validateDiagramSpec } from "../src/lib/diagram/spec.ts";
import { stripDiagramBlocks, hasDiagramContent, hideStreamingFence } from "../src/lib/diagram/markdown.ts";

let pass = 0, fail = 0;
const check = (name, cond, detail = "") => {
  cond ? (pass++, console.log("  ✓ " + name)) : (fail++, console.log("  ✗ " + name + " " + detail));
};

// —— 校验器 ——
const ok1 = validateDiagramSpec({ elements: [{ type: "polygon", points: [[0, 0], [4, 0], [0, 3]] }] });
check("合法最小 spec", ok1.ok);
check("axes:true 简写", validateDiagramSpec({ axes: true, elements: [{ type: "point", at: [0, 0] }] }).ok);
check("非法 JSON 类型", !validateDiagramSpec("[]").ok);
check("elements 缺失", !validateDiagramSpec({}).ok);
check("未知类型拒绝", !validateDiagramSpec({ elements: [{ type: "rect", from: [0, 0], to: [1, 1] }] }).ok);
check("坐标非数字拒绝", !validateDiagramSpec({ elements: [{ type: "point", at: ["0", 1] }] }).ok);
check("坐标 Infinity 拒绝", !validateDiagramSpec({ elements: [{ type: "point", at: [1, Infinity] }] }).ok);
check("坐标超界拒绝", !validateDiagramSpec({ elements: [{ type: "point", at: [1e6, 0] }] }).ok);
check("17 个元素超限拒绝", !validateDiagramSpec({ elements: Array.from({ length: 17 }, () => ({ type: "point", at: [0, 0] })) }).ok);
check("颜色注入拒绝（url()）", !validateDiagramSpec({ elements: [{ type: "polygon", points: [[0,0],[1,1],[1,0]], stroke: 'url(#evil)' }] }).ok);
check("颜色注入拒绝（rgba 文本）", !validateDiagramSpec({ elements: [{ type: "polygon", points: [[0,0],[1,1],[1,0]], fill: "rgba(0,0,0,1)" }] }).ok);
check("合法 8 位 hex", validateDiagramSpec({ elements: [{ type: "polygon", points: [[0,0],[1,1],[1,0]], fill: "#38bdf826", stroke: "none" }] }).ok);
check("3 位 hex", validateDiagramSpec({ elements: [{ type: "polygon", points: [[0,0],[1,1],[1,0]], stroke: "#abc" }] }).ok);
check("半径为 0 拒绝", !validateDiagramSpec({ elements: [{ type: "circle", center: [0, 0], r: 0 }] }).ok);
check("半径负数拒绝", !validateDiagramSpec({ elements: [{ type: "circle", center: [0, 0], r: -2 }] }).ok);
check("xRange 逆序拒绝", !validateDiagramSpec({ axes: { visible: true, xRange: [5, 1] }, elements: [{ type: "point", at: [0, 0] }] }).ok);
check("多边形单点拒绝", !validateDiagramSpec({ elements: [{ type: "polygon", points: [[0, 0]] }] }).ok);
check("label 无文字拒绝", !validateDiagramSpec({ elements: [{ type: "label", at: [0, 0] }] }).ok);
check("字符串超长拒绝", !validateDiagramSpec({ elements: [{ type: "label", at: [0, 0], text: "x".repeat(81) }] }).ok);
check("退化：单点 spec 合法", validateDiagramSpec({ elements: [{ type: "point", at: [2, 2] }] }).ok);

// —— 围栏剥离 ——
const wiki = "讲解 A\n```diagram\n{\"elements\":[]}\n```\n后续 B\n```python\nprint(1)\n```\n完 C";
check("剥离只删 diagram", !stripDiagramBlocks(wiki).includes("diagram") && stripDiagramBlocks(wiki).includes("print(1)"), JSON.stringify(stripDiagramBlocks(wiki)));
check("hasDiagramContent", hasDiagramContent(wiki) === true && hasDiagramContent("普通文本") === false);
check("无围栏原样返回", stripDiagramBlocks("plain") === "plain");
const unclosedMd = "正文图示开头：\n```diagram\n{\"elements\":[{\"type\":\"point\"";
check("未闭合块剥到末尾", stripDiagramBlocks(unclosedMd) === "正文图示开头：\n", JSON.stringify(stripDiagramBlocks(unclosedMd)));
const twoBlocks = "s1\n```diagram\nA\n```\ns2\n```diagram\nB\n```\ns3";
check("两块全剥离", stripDiagramBlocks(twoBlocks) === "s1\ns2\ns3", JSON.stringify(stripDiagramBlocks(twoBlocks)));

// —— 流式占位 ——
const streamTail = "已出文字段落\n\n```diagram\n{\"elements\":[{\"type\":\"poin";
check("未闭合 diagram → 占位", hideStreamingFence(streamTail).includes("📐 图示生成中") && !hideStreamingFence(streamTail).includes("{"), JSON.stringify(hideStreamingFence(streamTail)));
check("已闭合不占位", hideStreamingFence(wiki) === wiki);
const pyTail = "文字\n```python\nprint(1";
check("未闭合 python → 代码占位", hideStreamingFence(pyTail).includes("💻 代码生成中"), JSON.stringify(hideStreamingFence(pyTail)));
const pyClosedTail = "文字\n```python\nprint(1)\n```\n更多文字";
check("已闭合 python 不占位", hideStreamingFence(pyClosedTail) === pyClosedTail);
const diagramThenPy = "a\n```diagram\n{}\n```\nb\n```python\nprint(1";
check("取最后开启的围栏", hideStreamingFence(diagramThenPy).includes("💻"));
check("普通文本不占位", hideStreamingFence("你好") === "你好");
const fenceInlineTriple = "文字包含 ``` 行内展示但不属于围栏开启";
check("行内三反引号不误伤", hideStreamingFence(fenceInlineTriple) === fenceInlineTriple);
const enabledClosedLastEmpty = "```diagram\n{\"elements\":[]}\n```";
check("围栏在末尾且闭合 → 不占位", hideStreamingFence(enabledClosedLastEmpty) === enabledClosedLastEmpty, JSON.stringify(hideStreamingFence(enabledClosedLastEmpty)));

console.log(`\n===== ${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail > 0 ? 1 : 0);
