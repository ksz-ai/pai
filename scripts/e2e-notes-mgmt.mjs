/**
 * 笔记管理（A/B/C）端到端验证。用法：dev + mock-llm 运行后 node scripts/e2e-notes-mgmt.mjs
 * 安全机制：
 * 1. 配置备份写入 data/settings.e2e-backup.json（崩溃后下次运行自动还原），不再依赖内存
 * 2. 最近 3 分钟内有模型调用（可能正在使用应用）→ 拒绝运行
 * 3. 结束恢复配置后读回验证，确保 mock 配置不残留
 */
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(process.cwd() + "/x.js");
const Database = require("better-sqlite3");

const BASE = "http://localhost:3000";
const BACKUP_PATH = "data/settings.e2e-backup.json";
let pass = 0;
let fail = 0;
const check = (name, cond, detail = "") => {
  cond ? (pass++, console.log("  ✓ " + name)) : (fail++, console.log("  ✗ " + name + " " + detail));
};
const post = async (url, body) =>
  await fetch(BASE + url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const json = async (r) => await r.json();

// ---- 安全与备份 ----
const db = new Database("data/pai.db");

// 0a. 崩溃恢复：上次运行若未正常恢复配置，先从备份文件还原
if (fs.existsSync(BACKUP_PATH)) {
  const saved = JSON.parse(fs.readFileSync(BACKUP_PATH, "utf8"));
  db.prepare("DELETE FROM settings").run();
  const up = db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)");
  for (const s of saved) up.run(s.key, s.value, new Date().toISOString());
  fs.rmSync(BACKUP_PATH);
  console.log("[recovery] 检测到上次运行未恢复的配置备份，已还原");
}

// 0b. 活动检测：应用正在被使用时拒绝运行（防止用户的对话被路由到 mock）
const lastCall = db.prepare("SELECT MAX(created_at) AS t FROM ai_logs").get().t;
if (lastCall && Date.now() - new Date(lastCall).getTime() < 3 * 60 * 1000) {
  console.log("[safety] 检测到 3 分钟内有模型调用（应用可能正在使用中），已拒绝运行以避免干扰。请稍后再试。");
  process.exit(1);
}

// 0c. 备份当前配置到文件（进程被杀也能恢复）
const savedSettings = db.prepare("SELECT key, value FROM settings").all();
fs.writeFileSync(BACKUP_PATH, JSON.stringify(savedSettings));
console.log(`[setup] 已备份当前配置（${savedSettings.length} 项）→ ${BACKUP_PATH}`);
// 画像条目快照（清理时删除测试新建的条目，避免保护期跨次污染）
const realEntryIds = new Set(db.prepare("SELECT id FROM profile_entries").all().map((r) => r.id));

// ---- mock 配置（注意：settings 路由只导出 PUT）----
const putSettings = await fetch(BASE + "/api/settings/llm", {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ base_url: "http://localhost:5099/v1", api_key: "mock-key-12345678", model: "mock-model" }),
});
if (!putSettings.ok) throw new Error(`切换 mock 配置失败：${putSettings.status}`);
const switchCheck = await (await fetch(`${BASE}/api/settings/llm`)).json();
if (switchCheck.model !== "mock-model") throw new Error(`切换未生效：${JSON.stringify(switchCheck)}`);
console.log("[setup] 已切换 mock 配置并验证生效");

const testConvIds = [];
const testNoteIds = [];
async function chat(convId, content) {
  await (await post("/api/chat", { conversation_id: convId, content })).text();
}

try {
  // [1] 生成笔记 + 领域归类
  console.log("\n[1] 领域归类与搜索（A）");
  const conv1 = await json(await post("/api/conversations", {}));
  testConvIds.push(conv1.id);
  await chat(conv1.id, "什么是特征值");
  const g1 = await json(await post("/api/notes/generate", { conversation_id: conv1.id }));
  const note1 = g1.note;
  testNoteIds.push(note1.id);
  check("领域自动归类=线性代数", note1.domain === "线性代数", `实际 ${note1.domain}`);
  check("锚点 v2 格式", note1.anchors.every((a) => a.id && a.conversation_id === conv1.id) && note1.content.includes("[[a1]]"));

  const search1 = await json(await fetch(`${BASE}/api/notes?q=${encodeURIComponent("特征值")}`));
  check("搜索命中", search1.notes.length >= 1);
  const search2 = await json(await fetch(`${BASE}/api/notes?q=${encodeURIComponent("量子纠缠zzz")}`));
  check("无结果搜索", search2.notes.length === 0);

  // [2] 按概念归组
  console.log("\n[2] 归组视图（B-1）");
  const grouped = await json(await fetch(`${BASE}/api/notes?grouped=1`));
  const g = grouped.groups.find((x) => x.concept_name === "特征值");
  check("归组包含本笔记", Boolean(g) && g.notes.some((n) => n.id === note1.id));

  // [3] 追加整理（第二个会话合并进 note1）
  console.log("\n[3] 追加整理（B-1）");
  const conv2 = await json(await post("/api/conversations", {}));
  testConvIds.push(conv2.id);
  await chat(conv2.id, "特征值在推荐系统里怎么用");
  const appRes = await json(await post("/api/notes/append", { note_id: note1.id, conversation_id: conv2.id }));
  check("追加成功且登记新锚点", appRes.added >= 1);
  const afterAppend = await json(await fetch(`${BASE}/api/notes/${note1.id}`));
  const conv2Anchors = afterAppend.note.anchors.filter((a) => a.conversation_id === conv2.id);
  const conv1Anchors = afterAppend.note.anchors.filter((a) => a.conversation_id === conv1.id);
  check("新锚点指向会话2", conv2Anchors.length >= 1);
  check("旧锚点保留指向会话1", conv1Anchors.length >= 1 && afterAppend.note.content.includes("[[a1]]"));
  check("版本 +1", afterAppend.note.version === note1.version + 1);
  const dup = await post("/api/notes/append", { note_id: note1.id, conversation_id: conv2.id });
  check("同一会话重复追加 → 409", dup.status === 409);

  // [4] SKIP 路径
  const conv3 = await json(await post("/api/conversations", {}));
  testConvIds.push(conv3.id);
  await chat(conv3.id, "skip测试 无关紧要的内容");
  const skipRes = await json(await post("/api/notes/append", { note_id: note1.id, conversation_id: conv3.id }));
  check("无实质内容 → SKIP", skipRes.unchanged === true);

  // [5] 多篇合并
  console.log("\n[4] 多篇合并（B-2）");
  const g2 = await json(await post("/api/notes/generate", { conversation_id: conv2.id }));
  const note2 = g2.note;
  testNoteIds.push(note2.id);
  const mergeRes = await json(await post("/api/notes/merge", { note_ids: [note1.id, note2.id] }));
  const merged = mergeRes.note;
  testNoteIds.push(merged.id);
  check("合并产出新笔记", Boolean(merged?.id) && merged.id !== note1.id && merged.id !== note2.id);
  const tokensInMerged = merged.content.match(/\[\[([^\]]+)\]\]/g) ?? [];
  check("无幻觉 token（[[m99]] 剔除）", !merged.content.includes("[[m99]]"));
  check("溯源 token 均在映射内", tokensInMerged.every((t) => merged.anchors.some((a) => a.id === t.slice(2, -2))));
  const src1 = await json(await fetch(`${BASE}/api/notes/${note1.id}`));
  check("源笔记不被改动", src1.note.version === afterAppend.note.version);

  // [6] 复习
  console.log("\n[5] 复习轻量版（C）");
  const cards = await json(await fetch(`${BASE}/api/notes/${note1.id}/cards`));
  check("卡片抽取 ≥1", cards.cards.length >= 1, `实际 ${cards.cards.length}`);
  // 运行级唯一概念：评分测试绝不触碰用户真实画像条目
  const e2eTag = db.prepare("SELECT name FROM concepts WHERE name LIKE 'e2e概念%' ORDER BY created_at DESC LIMIT 1").get().name;
  const e2eEntry = db.prepare("SELECT pe.id, pe.mastery FROM profile_entries pe JOIN concepts c ON c.id=pe.concept_id WHERE c.name = ?").get(e2eTag);
  const beforeMastery = e2eEntry.mastery;
  const grade1 = await json(await post("/api/review/grade", { note_id: note1.id, concept_name: e2eTag, grade: "known" }));
  check("「会」+0.1", grade1.masteryChanged && Math.abs(grade1.mastery - (beforeMastery + 0.1)) < 0.001, JSON.stringify(grade1));
  const grade2 = await json(await post("/api/review/grade", { note_id: note1.id, concept_name: e2eTag, grade: "unknown" }));
  check("「不会」−0.15", Math.abs(grade2.mastery - (beforeMastery + 0.1 - 0.15)) < 0.001, JSON.stringify(grade2));

  // [7] 保护期拦截
  await fetch(`${BASE}/api/profile/${e2eEntry.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mastery: 0.6 }),
  });
  const grade3 = await json(await post("/api/review/grade", { note_id: note1.id, concept_name: e2eTag, grade: "unknown" }));
  check("保护期拦截自评（E-06 继承）", grade3.skipped === true && grade3.mastery === 0.6, JSON.stringify(grade3));

  // [8] 队列
  const queue = await json(await fetch(`${BASE}/api/review/queue`));
  const qItem = queue.queue.find((x) => x.note.id === note1.id);
  check("队列包含卡片笔记", Boolean(qItem) && qItem.cardCount >= 1, `实际 ${qItem?.cardCount}`);

  // [9] 用户自定义分类（分类体系优化）
  console.log("\n[6] 自定义分类");
  const beforeDomain = (await json(await fetch(`${BASE}/api/notes/${note1.id}`))).note.domain;
  await fetch(`${BASE}/api/notes/${note1.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ domain: "我的自定义分类" }),
  });
  let afterDomain = (await json(await fetch(`${BASE}/api/notes/${note1.id}`))).note;
  check("手动设置领域生效", afterDomain.domain === "我的自定义分类" && afterDomain.domain_locked === true);
  // 内容再写入（加术语表）→ 锁定笔记领域不被自动归类覆盖
  await fetch(`${BASE}/api/notes/${note1.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ glossary_add: { term: "测试术语", explanation: "锁定验证用" } }),
  });
  afterDomain = (await json(await fetch(`${BASE}/api/notes/${note1.id}`))).note;
  check("锁定后写内容领域不被覆盖", afterDomain.domain === "我的自定义分类" && afterDomain.domain_locked === true);
  check("领域未等于自动归类值", afterDomain.domain !== beforeDomain);
  // [9] 自定义标签与归组去重（分类体系优化）
  console.log("\n[6] 自定义标签与归组去重");
  const labelRes = await json(await post("/api/notes", { name: "测试标签ABC" }));
  check("新建自定义标签", labelRes.customDomains.includes("测试标签ABC"));
  await fetch(BASE + "/api/notes/" + note1.id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ domain: "测试标签ABC" }) });
  const grouped2 = await json(await fetch(BASE + "/api/notes?grouped=1"));
  const myGroup = grouped2.groups.find((g) => g.notes.some((n) => n.id === note1.id));
  check("归组后笔记唯一（同义组合并）", myGroup && myGroup.notes.filter((n) => n.id === note1.id).length === 1, JSON.stringify(grouped2.groups.map(g => ({name: g.concept_name, count: g.notes.length}))));
  check("自定义标签组存在", grouped2.customDomains.includes("测试标签ABC") || myGroup?.concept_name === "测试标签ABC");

  // [10] 融合批次 F1：人格设置往返 + 主动洞察
  console.log("\n[7] 融合批次 F1（人格/洞察/回现）");
  await fetch(`${BASE}/api/settings/llm`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ base_url: "http://localhost:5099/v1", model: "mock-model", tutor_persona: "socratic" }),
  });
  const personaCheck = await json(await fetch(`${BASE}/api/settings/llm`));
  check("人格设置往返（socratic）", personaCheck.tutor_persona === "socratic");
  const convF1 = await json(await post("/api/conversations", {}));
  testConvIds.push(convF1.id);
  await chat(convF1.id, "什么是特征值");
  const f1meta = db
    .prepare("SELECT meta FROM messages WHERE conversation_id = ? AND role = 'assistant' ORDER BY created_at DESC LIMIT 1")
    .get(convF1.id);
  check("meta.persona 记录", f1meta && f1meta.meta.includes("socratic"));
  const insightsRes = await json(await fetch(`${BASE}/api/insights`));
  check("洞察 ≤3 条", insightsRes.insights.length <= 3 && insightsRes.insights.length >= 1, JSON.stringify(insightsRes.insights.map((i) => i.title)));
  const reviewInsight = insightsRes.insights.find((i) => i.href.startsWith("/review"));
  check("复习到期洞察触发", Boolean(reviewInsight));
  const weakInsight = insightsRes.insights.find((i) => i.title.includes("最薄弱") || i.detail.includes("掌握度仅"));
  check("薄弱概念洞察触发", Boolean(weakInsight));
  // 记忆回现指令由构建与 prompt 单元覆盖（explain.ts 静态内容），此处不重复断言

  // [11] 苏格拉底多轮引导全流程（融合批次 F1+）
  console.log("\n[8] 苏格拉底引导流程");
  await fetch(`${BASE}/api/settings/llm`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ base_url: "http://localhost:5099/v1", model: "mock-model", tutor_persona: "socratic" }),
  });
  const convSoc = await json(await post("/api/conversations", {}));
  testConvIds.push(convSoc.id);
  const sseText = async (body) => {
    const r = await fetch(`${BASE}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return (await r.text()).split("\n\n").filter((l) => l.startsWith("data:")).map((l) => JSON.parse(l.slice(5).trim()));
  };
  const ev1 = await sseText({ conversation_id: convSoc.id, content: "什么是递归" });
  const openAi = ev1.find((e) => e.type === "meta");
  check("开启轮 meta.persona=socratic", openAi?.persona === "socratic");
  const socMsgs1 = db.prepare("SELECT meta, content FROM messages WHERE conversation_id = ? AND role='assistant' ORDER BY created_at DESC LIMIT 1").get(convSoc.id);
  check("开启轮 state=guiding + 含引导问题", JSON.parse(socMsgs1.meta).socratic_state === "guiding" && socMsgs1.content.includes("引导问题"));
  const ev2 = await sseText({ conversation_id: convSoc.id, content: "我觉得是函数调用自己" });
  const socMsgs2 = db.prepare("SELECT meta, content FROM messages WHERE conversation_id = ? AND role='assistant' ORDER BY created_at DESC LIMIT 1").get(convSoc.id);
  check("续轮仍 guiding + 反馈用户回答", JSON.parse(socMsgs2.meta).socratic_state === "guiding" && socMsgs2.content.includes("自己调用自己"));
  const ev3 = await sseText({ conversation_id: convSoc.id, content: "明白了" });
  const socMsgs3 = db.prepare("SELECT meta, content FROM messages WHERE conversation_id = ? AND role='assistant' ORDER BY created_at DESC LIMIT 1").get(convSoc.id);
  check("复盘轮 state=done + 含复盘标记", JSON.parse(socMsgs3.meta).socratic_state === "done" && socMsgs3.content.includes("【学习复盘】"));
  const ev4 = await sseText({ conversation_id: convSoc.id, content: "什么是循环" });
  const socMsgs4 = db.prepare("SELECT meta, content FROM messages WHERE conversation_id = ? AND role='assistant' ORDER BY created_at DESC LIMIT 1").get(convSoc.id);
  check("复盘后新提问 → 重新开启引导", JSON.parse(socMsgs4.meta).socratic_state === "guiding");

} finally {
  // ---- 恢复：删除测试数据、从备份文件恢复配置、读回验证 ----
  for (const id of testNoteIds) await fetch(`${BASE}/api/notes/${id}`, { method: "DELETE" }).catch(() => {});
  for (const id of testConvIds) await fetch(`${BASE}/api/conversations/${id}`, { method: "DELETE" }).catch(() => {});
  if (fs.existsSync(BACKUP_PATH)) {
    const saved = JSON.parse(fs.readFileSync(BACKUP_PATH, "utf8"));
    db.prepare("DELETE FROM settings").run();
    const upsert = db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)");
    for (const s of saved) upsert.run(s.key, s.value, new Date().toISOString());
    // 读回验证：mock 配置不得残留
    const checkRows = db.prepare("SELECT key, value FROM settings WHERE key = 'llm_base_url'").get();
    const leaked = checkRows && /localhost:5099/.test(checkRows.value);
    if (leaked) {
      console.error("\n[cleanup][ERROR] 恢复验证失败：mock 配置仍残留！请检查 data/settings.e2e-backup.json 手动还原。");
      fail++;
    } else {
      fs.rmSync(BACKUP_PATH);
      console.log(`\n[cleanup] 配置已恢复并验证（${saved.length} 项）、删除测试会话 ${testConvIds.length} 个 / 笔记 ${testNoteIds.length} 篇；用户真实数据保留`);
    }
  }
  // 画像条目清理：删除测试期间新建的条目（保护期等状态不跨次污染）
  const entryCleanup = db.prepare(
    `DELETE FROM profile_entries WHERE id NOT IN (${[...realEntryIds].map(() => "?").join(",") || "''"})`,
  );
  entryCleanup.run(...realEntryIds);
  db.prepare(
    `DELETE FROM profile_logs WHERE profile_entry_id NOT IN (SELECT id FROM profile_entries)`,
  ).run();
}

console.log(`\n========== 笔记管理结果：${pass} 通过 / ${fail} 失败 ==========`);
process.exit(fail > 0 ? 1 : 0);
