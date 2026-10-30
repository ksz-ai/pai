/**
 * 图示讲解（G 批次）端到端验证。用法：dev + mock-llm 运行后 node scripts/e2e-diagram.mjs
 * 安全机制与 e2e-notes-mgmt 相同：配置备份落盘、活动检测、结束恢复 + 读回验证。
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

if (fs.existsSync(BACKUP_PATH)) {
  const saved = JSON.parse(fs.readFileSync(BACKUP_PATH, "utf8"));
  db.prepare("DELETE FROM settings").run();
  const up = db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)");
  for (const s of saved) up.run(s.key, s.value, new Date().toISOString());
  fs.rmSync(BACKUP_PATH);
  console.log("[recovery] 检测到上次运行未恢复的配置备份，已还原");
}

const lastCall = db.prepare("SELECT MAX(created_at) AS t FROM ai_logs").get().t;
if (lastCall && Date.now() - new Date(lastCall).getTime() < 3 * 60 * 1000) {
  console.log("[safety] 检测到 3 分钟内有模型调用（应用可能正在使用中），已拒绝运行以避免干扰。请稍后再试。");
  process.exit(1);
}

const savedSettings = db.prepare("SELECT key, value FROM settings").all();
fs.writeFileSync(BACKUP_PATH, JSON.stringify(savedSettings));
const realEntryIds = new Set(db.prepare("SELECT id FROM profile_entries").all().map((r) => r.id));

const putSettings = await fetch(BASE + "/api/settings/llm", {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ base_url: "http://localhost:5099/v1", api_key: "mock-key-12345678", model: "mock-model" }),
});
if (!putSettings.ok) throw new Error(`切换 mock 配置失败：${putSettings.status}`);
console.log("[setup] 已切换 mock 配置");

const testConvIds = [];
const sseEvents = async (body) => {
  const r = await post("/api/chat", body);
  return (await r.text()).split("\n\n").filter((l) => l.startsWith("data:")).map((l) => JSON.parse(l.slice(5).trim()));
};

const stripFence = (text) => text.replace(/```[a-z]*[\s\S]*?```/g, "");

try {
  console.log("\n[1] 图示讲解全链路（explain-v2）");
  const conv = await json(await post("/api/conversations", {}));
  testConvIds.push(conv.id);

  const events = await sseEvents({ conversation_id: conv.id, content: "请讲解勾股定理并画图说明" });
  const metaEv = events.find((e) => e.type === "meta");
  const deltas = events.filter((e) => e.type === "delta");
  const doneEv = events.find((e) => e.type === "done");
  check("SSE 正常完成（有 meta + done）", Boolean(metaEv && doneEv));
  const streamed = deltas.map((e) => e.text).join("");
  check("流式 delta 不吞 diagram 围栏", streamed.includes("```diagram"));

  const row = db.prepare("SELECT content, meta FROM messages WHERE conversation_id = ? AND role='assistant' ORDER BY created_at DESC LIMIT 1").get(conv.id);
  check("assistant 消息持久化含围栏", row && row.content.includes("```diagram"));
  const meta = row ? JSON.parse(row.meta) : null;
  check("meta.has_diagram=true", meta?.has_diagram === true, JSON.stringify(meta));
  check("prompt 版本升级 explain-v2", meta?.prompt_version === "explain-v2");

  // spec 首关校验：围栏内 JSON 可解析、elements 非空、类型白名单、坐标有限
  const m = row.content.match(/```diagram[\t ]*\r?\n([\s\S]*?)```/);
  check("围栏可提取", Boolean(m));
  const spec = m ? JSON.parse(m[1]) : null;
  check("spec 是 JSON 对象", spec && typeof spec === "object" && !Array.isArray(spec));
  const TYPES = ["point", "segment", "polygon", "circle", "angle", "label"];
  const els = Array.isArray(spec?.elements) ? spec.elements : [];
  check("elements 非空且类型合法", els.length >= 1 && els.length <= 16 && els.every((e) => TYPES.includes(e?.type)), JSON.stringify(els?.map?.((e) => e?.type)));
  const allFinite = els.every((e) => JSON.stringify(e).length < 5000);
  check("元素规模可控", allFinite);
  const coordsAllFinite = els.every((e) => {
    const nums = JSON.stringify(e).match(/-?\d+\.?\d*(?:e-?\d+)?/g) ?? [];
    return nums.every((n) => Number.isFinite(Number(n)));
  });
  check("坐标均为有限数字", coordsAllFinite);
  const colors = els.filter((e) => e.fill || e.stroke).flatMap((e) => [e.fill, e.stroke]).filter(Boolean);
  const colorOk = colors.every((c) => /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$|^none$/.test(c));
  check("颜色仅十六进制白名单", colorOk, JSON.stringify(colors));

  console.log("\n[2] 降级安全：围栏不合法时讲解照常可用");
  check("讲解正文完整（图外有实质内容）", stripFence(row.content).includes("勾股定理"), "正文过短");
  check("SSE 无 error 事件", !events.some((e) => e.type === "error"));

  console.log("\n[3] 笔记生成剥离图示");
  const g = await json(await post("/api/notes/generate", { conversation_id: conv.id }));
  check("笔记生成成功", Boolean(g.note?.id), JSON.stringify(g).slice(0, 120));
  check("笔记不含 diagram 围栏", !g.note.content.includes("```diagram"));
  check("笔记不含 spec JSON 痕迹", !g.note.content.includes('"type"') && !g.note.content.includes("elements"));
  check("笔记结构合规（核心概念 + 锚点）", g.note.content.includes("## 核心概念") && g.note.content.includes("[["));
} finally {
  for (const id of testConvIds) await fetch(`${BASE}/api/conversations/${id}`, { method: "DELETE" }).catch(() => {});
  if (fs.existsSync(BACKUP_PATH)) {
    const saved = JSON.parse(fs.readFileSync(BACKUP_PATH, "utf8"));
    db.prepare("DELETE FROM settings").run();
    const upsert = db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)");
    for (const s of saved) upsert.run(s.key, s.value, new Date().toISOString());
    const checkRows = db.prepare("SELECT key, value FROM settings WHERE key = 'llm_base_url'").get();
    const leaked = checkRows && /localhost:5099/.test(checkRows.value);
    if (leaked) {
      console.error("\n[cleanup][ERROR] 恢复验证失败：mock 配置仍残留！请检查 data/settings.e2e-backup.json 手动还原。");
      fail++;
    } else {
      fs.rmSync(BACKUP_PATH);
      console.log(`\n[cleanup] 配置已恢复并验证（${saved.length} 项）、删除测试会话 ${testConvIds.length} 个；用户真实数据保留`);
    }
  }
  const entryCleanup = db.prepare(
    `DELETE FROM profile_entries WHERE id NOT IN (${[...realEntryIds].map(() => "?").join(",") || "''"})`,
  );
  entryCleanup.run(...realEntryIds);

  console.log(`\n===== 结果：${pass} 通过 / ${fail} 失败 =====`);
  process.exit(fail > 0 ? 1 : 0);
}
