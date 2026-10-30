import { createRequire } from "node:module";
import fs2 from "node:fs";
const require = createRequire(process.cwd() + "/x.js");
const Database = require("better-sqlite3");

const BASE = "http://localhost:3000";
const BACKUP_PATH = "data/settings.e2e-backup.json";
// ---- 安全与备份（分类体系优化同期加固）----
const dbGuard = new Database("data/pai.db");
if (fs2.existsSync(BACKUP_PATH)) {
  const saved = JSON.parse(fs2.readFileSync(BACKUP_PATH, "utf8"));
  dbGuard.prepare("DELETE FROM settings").run();
  const up = dbGuard.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)");
  for (const s of saved) up.run(s.key, s.value, new Date().toISOString());
  fs2.rmSync(BACKUP_PATH);
  console.log("[recovery] 检测到上次未恢复的配置备份，已还原");
}
const lastCall = dbGuard.prepare("SELECT MAX(created_at) AS t FROM ai_logs").get().t;
if (lastCall && Date.now() - new Date(lastCall).getTime() < 3 * 60 * 1000) {
  console.log("[safety] 检测到 3 分钟内有模型调用，已拒绝运行以避免干扰。请稍后再试。");
  process.exit(1);
}
fs2.writeFileSync(BACKUP_PATH, JSON.stringify(dbGuard.prepare("SELECT key, value FROM settings").all()));

let pass = 0, fail = 0;
const check = (name, cond, detail = "") => { cond ? (pass++, console.log("  ✓ " + name)) : (fail++, console.log("  ✗ " + name + " " + detail)); };
const post = async (url, body) => (await fetch(BASE + url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
const sseEvents = async (res) => {
  const text = await res.text();
  return text.split("\n\n").filter(l => l.startsWith("data:")).map(l => JSON.parse(l.slice(5).trim()));
};
const glossarySection = (content) => {
  const idx = content.indexOf("## 术语表");
  return idx === -1 ? "" : content.slice(idx);
};

// 0. 指向 mock
await fetch(BASE + "/api/settings/llm", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ base_url: "http://localhost:5099/v1", api_key: "mock-key-12345678", model: "mock-model" }) });

// 1. 对话 → 生成笔记
console.log("\n[1] 对话 + 笔记生成");
const conv = await (await post("/api/conversations", {})).json();
const events = await sseEvents(await post("/api/chat", { conversation_id: conv.id, content: "什么是特征值" }));
check("对话完成", events.some(e => e.type === "done"));
const noteRes = await (await post("/api/notes/generate", { conversation_id: conv.id })).json();
check("笔记生成", Boolean(noteRes.note?.id));
const noteId = noteRes.note.id;

// 2. 划词解答
console.log("\n[2] 划词解答（FR-06）");
const selEvents = await sseEvents(await post("/api/selection/explain", { note_id: noteId, text: "特征值" }));
const selText = selEvents.filter(e => e.type === "delta").map(e => e.text).join("");
check("流式解答", selText.length > 10, JSON.stringify(selEvents.filter(e => e.type !== "delta")).slice(0, 200));
const sel2 = await sseEvents(await post("/api/selection/explain", { note_id: noteId, text: "xyzab乱码串" }));
const notFoundText = sel2.filter(e => e.type === "delta").map(e => e.text).join("");
check("乱码→未找到（AC-06-3）", notFoundText.replace(/[*\s]/g, "").startsWith("未找到相关解释"));
const sel3 = await sseEvents(await post("/api/selection/explain", { note_id: noteId, text: "长".repeat(300) }));
check("超200字→拦截（AC-06-2）", sel3.some(e => e.type === "error" && e.code === "too_long"));
const sel4 = await sseEvents(await post("/api/selection/explain", { note_id: noteId, text: "特征值", rephrase: true }));
const rephraseText = sel4.filter(e => e.type === "delta").map(e => e.text).join("");
check("换种说法", rephraseText.includes("换个角度"));
const dbMod = await import("better-sqlite3");
const db = new dbMod.default("data/pai.db");
check("SelectionEvent 落库（FR-06 ⑥）", db.prepare("SELECT COUNT(*) n FROM selection_events").get().n >= 3);

// 3. 术语表（FR-07）
console.log("\n[3] 加入笔记 / 术语表");
const patch = async (body) => await fetch(`${BASE}/api/notes/${noteId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const g1 = await (await patch({ glossary_add: { term: "特征值", explanation: "满足 Av=λv 的标量（mock 解释）" } })).json();
check("首次加入成功", g1.exists === false && glossarySection(g1.note.content).includes("**特征值**"));
const g2 = await (await patch({ glossary_add: { term: "特征值", explanation: "重复加入测试" } })).json();
check("重复加入提示已存在（AC-07-1）", g2.exists === true && !g2.note.content.includes("重复加入测试"));
const g3 = await (await patch({ glossary_add: { term: "特征值", explanation: "更新后的解释 v2", replace: true } })).json();
check("更新解释生效且正文无损", glossarySection(g3.note.content).includes("更新后的解释 v2") && g3.note.content.includes("[[m1]]"), JSON.stringify(glossarySection(g3.note.content)));

// 4. 撤销（AC-07-2）
console.log("\n[4] 撤销");
check("旧版本快照保留（E-11 基础）", db.prepare("SELECT COUNT(*) n FROM note_versions WHERE note_id = ?").get(noteId).n >= 3);
const beforeUndo = g3.note.content;
const undoRes = await (await patch({ content: noteRes.note.content, force: true })).json();
check("撤销恢复原内容（AC-07-2）", !undoRes.note.content.includes("## 术语表"));

// 5. 编辑冲突（E-11）
console.log("\n[5] 多标签冲突");
await patch({ glossary_add: { term: "特征向量", explanation: "方向不变的向量" } });
const cur = (await (await fetch(`${BASE}/api/notes/${noteId}`)).json()).note;
const stale = await patch({ content: cur.content + "\n\n过时编辑", base_version: cur.version - 1 });
check("过期 base_version → 409 冲突", stale.status === 409);
const okRes = await (await patch({ content: cur.content + "\n\n强制保存", base_version: cur.version - 1, force: true })).json();
check("force 保存成功（保留我的版本）", okRes.note?.content?.includes("强制保存"));

// 6. 预算（FR-09）
console.log("\n[6] Token 预算");
const used = db.prepare("SELECT token_used FROM conversations WHERE id = ?").get(conv.id).token_used;
console.log("  当前会话 tokens:", used);
await fetch(BASE + "/api/settings/llm", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ base_url: "http://localhost:5099/v1", model: "mock-model", token_budget: Math.ceil(used / 0.9) }) });
const ev80 = await sseEvents(await post("/api/chat", { conversation_id: conv.id, content: "再讲讲特征值的应用" }));
check("达80%→压缩提示（AC-09-1）", ev80.some(e => e.type === "notice" && e.message.includes("80%")) && ev80.some(e => e.type === "done"), JSON.stringify(ev80.filter(e=>e.type==="notice")));
await fetch(BASE + "/api/settings/llm", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ base_url: "http://localhost:5099/v1", model: "mock-model", token_budget: 1000 }) });
const ev100 = await sseEvents(await post("/api/chat", { conversation_id: conv.id, content: "继续" }));
check("超100%→阻断（budget_exceeded）", ev100.some(e => e.type === "error" && e.code === "budget_exceeded"));
const noteBlocked = await post("/api/notes/generate", { conversation_id: conv.id });
check("笔记生成同样被阻断（E-05）", noteBlocked.status === 403);

console.log(`\n========== B4/B5 结果：${pass} 通过 / ${fail} 失败 ==========`);
process.exit(fail > 0 ? 1 : 0);
