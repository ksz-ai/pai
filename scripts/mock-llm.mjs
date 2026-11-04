/**
 * 本地 Mock LLM 服务器（OpenAI 兼容协议，端口 5099）。
 * 用于无真实 Key 的端到端验证：概念抽取 + 流式讲解（含数学公式）+ 笔记生成。
 * 用法：node scripts/mock-llm.mjs
 */
import http from "node:http";

const PORT = 5099;

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
  });
}

const EXPLAIN_TEXT = `### 什么是特征值

先补一句：**矩阵乘法**就是把矩阵按行列规则相乘的运算。

**特征值**是线性代数中的核心概念。设 $A$ 是一个 $n \\times n$ 的方阵，若存在非零向量 $v$ 使得：

$$Av = \\lambda v$$

则称 $\\lambda$ 是矩阵 $A$ 的一个**特征值**，$v$ 是对应的**特征向量**。

- 几何意义：$A$ 作用于 $v$ 只做缩放，不改变方向
- 例如 $A = \\begin{bmatrix} 2 & 0 \\\\ 0 & 3 \\end{bmatrix}$，特征值就是 2 和 3

所以：特征值刻画了变换在特定方向上的"伸缩倍数"。`;

const PYTHAGOREAN_TEXT = `### 勾股定理

先补一句：**直角三角形**就是有一个角是直角（90°）的三角形。

**勾股定理**说的是：直角三角形两条直角边的平方和等于斜边的平方，即：

$$a^2 + b^2 = c^2$$

\`\`\`diagram
{"elements":[{"type":"polygon","points":[[0,0],[4,0],[0,3]],"fill":"#0ea5e91a","stroke":"#38bdf8"},{"type":"segment","from":[0,0],"to":[4,0],"label":"a=4"},{"type":"segment","from":[0,0],"to":[0,3],"label":"b=3"},{"type":"segment","from":[4,0],"to":[0,3],"label":"c=5","dashed":true},{"type":"angle","at":[0,0],"from":[4,0],"to":[0,3],"rightAngle":true}]}
\`\`\`

如图，直角边 $a = 4$、$b = 3$，直角在左下角。代入定理：$4^2 + 3^2 = 16 + 9 = 25 = 5^2$，所以斜边 $c = 5$。

- 记忆口诀：**直角边的平方和 = 斜边的平方**
- 该关系仅对直角三角形成立，一般三角形需余弦定理推广`;

const NOTE_TEXT = `# 特征值入门

## 一句话总结
特征值描述了矩阵变换在某些方向上只缩放不旋转的倍数。

## 核心概念
- **特征值**：满足 $Av = \\lambda v$ 的 $\\lambda$ [[m1]]
- **特征向量**：变换后方向不变的向量 [[m1]]

## 例子
$A = \\begin{bmatrix} 2 & 0 \\\\ 0 & 3 \\end{bmatrix}$ 的特征值为 2 和 3。

## 常见误区
- 特征向量可以为零向量（错，必须非零）

## 延伸问题
- 特征值和行列式的关系是什么？`;

function sseChunks(text) {
  // 按字符块切开模拟流式
  const parts = text.match(/[\s\S]{1,40}/g) ?? [];
  return parts;
}

const server = http.createServer(async (req, res) => {
  const body = await readBody(req);
  let parsed = {};
  try {
    parsed = JSON.parse(body);
  } catch {
    /* ignore */
  }
  const system = parsed.messages?.[0]?.content ?? "";
  const lastUser = [...(parsed.messages ?? [])].reverse().find((m) => m.role === "user")?.content ?? "";

  // 概念抽取
  if (system.includes("学习行为分析器")) {
    console.log("[mock] extract:", lastUser.slice(0, 60));
    // 运行级唯一概念：评分类测试用，不与用户真实画像冲突
    if (!globalThis.__e2eTag) globalThis.__e2eTag = "e2e概念" + Date.now().toString(36).slice(-4);
    const content = JSON.stringify({
      concepts: [
        { name: "特征值", domain: "线性代数", is_main: true },
        { name: "矩阵乘法", domain: "线性代数", is_main: false },
        { name: globalThis.__e2eTag, domain: "线性代数", is_main: false },
      ],
    });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        choices: [{ message: { content } }],
        usage: { prompt_tokens: 100, completion_tokens: 30 },
      }),
    );
    return;
  }

  // 笔记生成
  if (system.includes("学习笔记整理器")) {
    console.log("[mock] note generate");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        choices: [{ message: { content: NOTE_TEXT } }],
        usage: { prompt_tokens: 500, completion_tokens: 200 },
      }),
    );
    return;
  }

  // 学习周报（M2-4）
  if (system.includes("学习周报生成器")) {
    console.log("[mock] weekly report");
    let data = {};
    try {
      data = JSON.parse(system.match(/## 本周数据（JSON）\n([\s\S]*?)\n\n## 输出结构/)?.[1] ?? "{}");
    } catch {}
    const report = `# 学习周报\n\n## 本周概览\n本周开启了 ${data.conversations ?? 2} 段学习会话，围绕特征值与递归展开，产出 ${data.notesCreated ?? 1} 篇笔记。\n\n## 掌握度变化\n- 「特征值」掌握度有所上升\n\n## 薄弱点\n- 「应用程序编程接口」掌握度 0.30，建议再来一轮针对性讲解\n\n## 下周建议\n- 完成《特征值入门》的卡片复习\n- 用苏格拉底模式再学一个新概念`;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: report } }], usage: { prompt_tokens: 600, completion_tokens: 300 } }));
    return;
  }

  // 苏格拉底式（融合批次 F1+：开启轮 / 续轮）
  if (system.includes("苏格拉底式引导")) {
    const isOpening = system.includes("开启轮");
    console.log("[mock] socratic:", isOpening ? "opening" : "continue");
    let text;
    if (isOpening) {
      text = `我们一起把「递归」弄清楚。要探索两个小问题：**它把大问题变成了什么？** 以及**什么时候停下来？**\n\n**引导问题：** 如果让你计算 1+2+3+…+100，你会怎么把这件事变成一个"更小的同类问题"？`;
    } else if (/明白了|复盘|总结吧|懂了/.test(lastUser)) {
      text = `【学习复盘】\n\n**我们一起学到了什么**\n- 递归 = 把大问题变成规模更小的同类问题\n- 必须有终止条件，否则无限递归\n\n**你的回答复盘**\n- "函数调用自己"——对了一半：正确抓住自指结构，漏了"规模必须变小"与终止条件\n\n**知识总结**\n递归是函数通过调用自身、把原问题分解为结构相同而规模更小的子问题，并在基准情形（终止条件）处直接给出答案的求解方式。\n\n**遗留问题**\n- 递归和循环如何互相改写？`;
    } else {
      text = `不错——你抓住了"自己调用自己"这个关键结构。再推进一步：如果**每次调用的规模都一样大**（比如 f(n) 调用 f(n)），会发生什么？\n\n**引导问题：** 这个"规模变小"对应代码里的什么？它由谁保证停下来？`;
    }
    if (parsed.stream) {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      for (const chunk of text.match(/[\s\S]{1,24}/g) ?? []) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}\n\n`);
        await new Promise((r) => setTimeout(r, 10));
      }
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: text } }], usage: { prompt_tokens: 300, completion_tokens: 300 } }));
    return;
  }

  // 追加整理（笔记管理 N2）
  if (system.includes("笔记增量整理器")) {
    const skip = /无关紧要|skip测试/i.test(system);
    console.log("[mock] append merge", skip ? "(SKIP)" : "");
    if (skip) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content: "SKIP" } }], usage: { prompt_tokens: 400, completion_tokens: 2 } }));
      return;
    }
    const merged = `# 特征值入门（合并版）\n\n## 一句话总结\n特征值描述缩放倍数，本轮补充了它在工程中的用法。\n\n## 核心概念\n- **特征值**：满足 $Av = \\lambda v$ 的 $\\lambda$ [[a1]]，实际工程中用于降维 [[m1]]\n\n## 例子\n新增例子：把用户向量投影到特征向量上做排序 [[m2]]\n\n## 常见误区\n- 特征向量可以为零向量（错）\n\n## 延伸问题\n- 特征值和行列式的关系是什么？`;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: merged } }], usage: { prompt_tokens: 800, completion_tokens: 200 } }));
    return;
  }

  // 多篇合并（笔记管理 N3）
  if (system.includes("笔记合并器")) {
    console.log("[mock] multi merge");
    const legal = (system.match(/\[\[(s\d+a\d+)\]\]/g) ?? []).slice(0, 2);
    const merged = `# 特征值主题总纲\n\n## 一句话总结\n特征值与特征向量是线性变换的"不动方向"工具。\n\n## 核心概念\n- **特征值**：${legal[0] ?? "[[s1a1]]"}\n- **特征向量**：${legal[1] ?? "[[s2a1]]"}\n- **幻觉标记**：[[m99]]\n\n## 例子\n（合并示例）\n\n## 常见误区\n- 零向量不是特征向量\n\n## 来源\n- 《特征值入门》`;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: merged } }], usage: { prompt_tokens: 900, completion_tokens: 200 } }));
    return;
  }

  // 划词解答（B4）
  if (system.includes("划词解答器")) {
    const term = lastUser.trim();
    const isRephrase = Boolean(parsed.messages?.[0]?.content?.includes("换种说法"));
    console.log("[mock] selection explain:", term.slice(0, 20), isRephrase ? "(rephrase)" : "");
    const notFound = /xyz|asdf|qwerty/i.test(term);
    const text = notFound
      ? "未找到相关解释"
      : isRephrase
        ? `换个角度理解**${term}**：想象把矩阵看作一台机器，特征向量就是机器只"推拉"而不"扭转"的方向，特征值就是推拉的力度。`
        : `**${term}**是线性代数中的基本概念：对矩阵而言，它是满足特定方程的标量，刻画了变换在某个方向上的缩放倍数。例如对角矩阵的特征值就是对角线上的元素。`;
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
    for (const chunk of text.match(/[\s\S]{1,20}/g) ?? []) {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}\n\n`);
      await new Promise((r) => setTimeout(r, 10));
    }
    res.write("data: [DONE]\n\n");
    res.end();
    return;
  }

  // 连接测试 / 流式讲解
  // 流式讲解
  if (parsed.stream) {
    const pythagorean = /勾股|直角三角/.test(lastUser);
    console.log(`[mock] stream explain${pythagorean ? " (diagram 勾股)" : ""}`);
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    });
    const text = pythagorean ? PYTHAGOREAN_TEXT : EXPLAIN_TEXT;
    for (const chunk of sseChunks(text)) {
      res.write(
        `data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}\n\n`,
      );
      await new Promise((r) => setTimeout(r, 15));
    }
    res.write(
      `data: ${JSON.stringify({ choices: [{ delta: {} }], usage: { prompt_tokens: 300, completion_tokens: 400 } })}\n\n`,
    );
    res.write("data: [DONE]\n\n");
    res.end();
    return;
  }

  console.log("[mock] plain completion (test connection)");
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      choices: [{ message: { content: "ok" } }],
      usage: { prompt_tokens: 5, completion_tokens: 1 },
    }),
  );
});

server.listen(PORT, () => console.log(`mock LLM listening on http://localhost:${PORT}/v1`));
