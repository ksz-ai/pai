# PAI · 个人 AI 学习应用（可运行原型）

基于《Personal AI 学习应用 · PRD V1.0》（见 `docs/PRD.html`）构建的**可运行功能原型**，已交付 **B1–B5 全部五批**：

> **B1–B3 核心闭环**：提问 → 画像驱动自适应讲解（L0–L2 判档）→ 深度反馈闭环 → 消息编辑/重生成 → 结构化笔记（六段式 + 溯源锚点）→ Markdown 导出 → 画像查看与纠错
> **B4 划词解答**：笔记阅读视图划词 → 即时解答浮层（按画像判档、防编造、超长转总结）→ 加入术语表（去重/更新解释/5 秒撤销）
> **B5 成本与兜底**：单会话 Token 预算（80% 自动压缩注入 / 100% 拦截新调用）、重试退避→备用模型降级链、多标签笔记编辑冲突（双版本保留+选择保留）
> **M2 · spec 驱动扩展**：可执行 Python 代码块（Pyodide 沙箱，matplotlib 出图/改代码重跑/30s 熔断）+ 知识图谱 /graph（手写力导向，掌握度着色/共现边/证据跳转）+ 与笔记对话（note-ask SSE 面板，问答存入延伸问题）+ 学习周报（数据聚合+叙事生成，周报即笔记）+ 讲解质量深化（explain-v2/diagram 规范/抽取主概念修复 extract-v2）
> **F1 思想融合**：记忆回现（讲解自然衔接历史）+ 导师人格四选一（通用/苏格拉底/教练/极简）+ 主动学习洞察卡（复习到期/薄弱概念/划词暗示）+ 完成桌面通知
> **N1–N5 笔记管理**：搜索 + 领域自动归类 + 筛选排序（A）、按概念归组视图 + 追加整理进已有笔记（B-1，锚点 v2 跨会话溯源）、多篇合并为总纲（B-2）、复习卡片（核心概念/术语表自动抽取）+ 自评回流画像 + 待复习队列 + Anki TSV 导出（C）

> **G1 图示讲解**：几何/空间类问题自动生成图示——LLM 在数学坐标系输出 ` ```diagram ` JSON 规范（线段/多边形/圆/点/直角标记/文字），前端确定性渲染为 SVG（自动取景 + Y 轴翻转），非法 spec 优雅降级占位；讲解引用图中标注（图文互证），苏格拉底引导轮禁图防剧透，笔记生成剥离图示源码

## 快速开始

```bash
npm install
npm run dev
# 打开 http://localhost:3000
```

**配置模型（界面完成，无需命令行）**：首次打开会看到顶部提示 → 点进「设置页」→ ① 选服务商（智谱 / DeepSeek / Kimi / OpenAI / 自定义）→ ② 粘贴 API Key → ③ 选模型 → 「保存」。可选点「测试连接」即时验证。**保存即生效，无需重启**。

> 开发者也可以预配置：复制 `.env.local.example` 为 `.env.local` 填写后启动；设置页配置优先于环境变量。

数据存储在本地 SQLite（`data/pai.db`），首次访问自动建库。

## 技术栈

- Next.js 16（App Router）+ TypeScript + Tailwind CSS 4
- better-sqlite3（13 张表：users / conversations / messages / notes / note_versions / note_concepts / concepts / profile_entries / profile_logs / review_logs / selection_events / settings / ai_logs）
- LLM 抽象层：OpenAI 兼容协议，多供应商可切换（`src/lib/llm/client.ts`）
- 流式输出：SSE（首 token 30s 超时 → 备用模型降级，E-01）

## 核心机制（对应 PRD）

| PRD 条目 | 实现位置 |
|---|---|
| FR-03 自适应讲解（判档 <0.3→L0 / 0.3–0.7→L1 / ≥0.7→L2 增量） | `src/lib/profile/engine.ts` `decideDepth` |
| FR-03 ① 前置补齐（相关概念 <0.7 先补 1–2 句） | `src/lib/pipeline/explain.ts` |
| FR-03 ⑤ 可解释（"为什么这么讲"面板） | 对话页 AI 消息底部 |
| FR-04 画像纠错（±0.1、30 天保护期、证据跳转、变更历史） | `/profile` 页 |
| FR-05 笔记（六段结构 + [[mN]] 锚点 + 导出「标题-日期.md」） | `/notes/[id]` 页 |
| FR-02 编辑/重生成（版本链保留旧版可回看、二次确认、后续回答标记 stale） | `/api/messages/[id]` + 对话页 |
| FR-08 信号采集（提问 0.3 初始 / 反馈 ±0.15 上限 0.2 / 手动权重最高 / 全量日志） | `src/lib/profile/engine.ts` |
| FR-03 ③ 90 天衰减 -0.1 | 读取画像时惰性结算（无定时任务） |
| G1 图示讲解（DSL v1 校验链 → SVG 确定性渲染） | `src/lib/diagram/spec.ts` + `Diagram.tsx`，prompt `explain-v2` |
| AC-01-2/E-12 会话删除级联（笔记标记来源已删除、证据清零条目移除） | `src/lib/db/repo/conversations.ts` |

## 与 PRD 的裁剪对照

**本原型包含（B1–B5 全量）**：流式对话、消息持久化、中断保留+重试、概念抽取（JSON→普通模式→关键词→本地正则四层降级）、画像判档与注入、三按钮反馈闭环、画像页全部交互、消息编辑重生成、笔记生成/锚点/编辑/导出、数学公式渲染（KaTeX + 分隔符归一化）、划词解答与术语表（FR-06/07）、Token 预算压缩与阻断（FR-09）、重试退避+备用模型（E-01/E-02/AC-09-2）、笔记编辑冲突双版本保留（E-11）、设置页界面化配置（服务商预设/Key 掩码/测试连接，E-13）、学习面板与数据导出删除。

**已知偏差（工程近似）**：
- "对话中正确应用 +0.2"（FR-03 ③）无法自动检测 → 掌握度由反馈按钮与手动纠错驱动
- 划词信号（FR-06 ⑥）记录 SelectionEvent 表 + 已有条目 touch，不为陌生词自动建画像条目
- 概念去重依赖抽取 prompt 注入已有概念名单，无模糊匹配；未做向量检索（PRD §5.3 V0.6 触发）
- 埋点为 ai_logs（模型调用维度），PRD 10.2 的前端事件流（conv_start 等）未单独建表，指标暂由 ai_logs + stats 聚合
- E-10（存储失败）依赖 SQLite 同步写 + 路由 500 报错，无本地暂存队列

## 目录结构

```
src/
├── app/                    # 页面 + API 路由
│   ├── page.tsx            # 会话列表（入口）
│   ├── chat/[id]/          # 对话页（主工作台）
│   ├── notes/              # 笔记列表 + 阅读视图
│   ├── profile/            # 画像页
│   ├── settings/           # 设置页
│   └── api/                # chat(SSE) / regenerate / messages / notes / profile / stats / data / health
├── lib/
│   ├── db/                 # SQLite 连接 + 8 表 schema + 仓库层
│   ├── llm/                # OpenAI 兼容客户端 + 三套版本化 prompt
│   ├── profile/engine.ts   # 判档 / 掌握度规则 / 保护期 / 衰减
│   ├── pipeline/explain.ts # 自适应讲解主管线
│   └── sse.ts
└── components/             # chat / notes / common
```

## 验证

- `npm run build`：编译通过（含笔记管理 N1–N5）
- `node scripts/seed-test.mjs`（dev 启动后运行）：14 项业务规则断言——惰性衰减、手动纠错+30 天保护期、变更日志四要素、会话删除级联、无 Key 503
- `node scripts/e2e-b4b5.mjs`（dev + `node scripts/mock-llm.mjs` 运行后）：17 项端到端断言，覆盖划词解答/防编造/超长拦截/换种说法/SelectionEvent、术语表加入去重更新撤销、笔记版本快照与 E-11 冲突、预算压缩/阻断（AC-09-1）、笔记生成阻断
- `node scripts/e2e-notes-mgmt.mjs`（同上环境）：20 项端到端断言，覆盖领域归类、搜索、归组视图、追加整理（锚点 v2 跨会话改写 + 重复追加 409 + SKIP）、多篇合并（幻觉 token 剔除 + 源笔记不动）、复习卡片抽取、自评回流（含保护期拦截）、复习队列
- `node scripts/e2e-diagram.mjs`（同上环境）：17 项端到端断言，覆盖 diagram 围栏流式不吞、`meta.has_diagram`、spec 首关校验（JSON/类型白名单/坐标有限/颜色白名单）、讲解正文不受围栏影响、笔记源文本剥离图示
- 真实模型验收（需配置 Key）：AC-03-1/2/3（前置补齐与判档）、AC-05-1/2（锚点与导出）、AC-06-1（划词深度）

## 上游文档

`docs/PRD.html` — 《Personal AI 学习应用 · 产品需求文档 V1.0》（2026-10-22）
