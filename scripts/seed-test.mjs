/**
 * 画像引擎与级联规则验证脚本（不需要 LLM Key）。
 * 用法：node scripts/seed-test.mjs
 * 覆盖：AC-04-1（保护期）、AC-08-2（变更日志）、AC-01-2/E-12（会话删除级联）、惰性衰减。
 */
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

const BASE = "http://localhost:3000";
const db = new Database("data/pai.db");

let pass = 0;
let fail = 0;
function check(name, cond, detail = "") {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name} ${detail}`);
  }
}

const user = db.prepare("SELECT id FROM users LIMIT 1").get().id;

// ---------- 种子数据 ----------
console.log("\n[1] 种子数据");
const convId = randomUUID();
const msgId = randomUUID();
const ts = new Date().toISOString();
db.prepare("INSERT INTO conversations (id,user_id,title,created_at,updated_at) VALUES (?,?,?,?,?)").run(convId, user, "线性代数入门", ts, ts);
db.prepare("INSERT INTO messages (id,conversation_id,user_id,role,content,slot_index,revision,status,created_at) VALUES (?,?,?,?,?,0,1,'normal',?)").run(msgId, convId, user, "user", "什么是矩阵乘法？", ts);

const conceptId = randomUUID();
db.prepare("INSERT INTO concepts (id,name,domain,created_at) VALUES (?,?,?,?)").run(conceptId, "矩阵乘法", "线性代数", ts);
const entryId = randomUUID();
const stale = new Date(Date.now() - 95 * 86400_000).toISOString(); // 95 天前未接触 → 应衰减
db.prepare("INSERT INTO profile_entries (id,user_id,concept_id,mastery,source_type,evidence_refs,last_touched_at,updated_at) VALUES (?,?,?,?,?,?,?,?)").run(
  entryId, user, conceptId, 0.8, "system", JSON.stringify([{ type: "message", id: msgId, conversation_id: convId, slot: 0 }]), stale, stale,
);

const noteId = randomUUID();
db.prepare("INSERT INTO notes (id,user_id,conversation_id,source_conversation_id,source_title,title,content,anchors,status,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,1,?,?)").run(
  noteId, user, convId, convId, "线性代数入门", "矩阵乘法笔记", "# 矩阵乘法笔记\n\n## 核心概念\n- **矩阵乘法**：定义 [[m0]]", JSON.stringify([{ slot: 0 }]), "draft", ts, ts,
);

// ---------- 验证 ----------
console.log("\n[2] 惰性衰减（GET /api/profile 触发，95 天未接触 0.8 → 0.7）");
let entries = await (await fetch(`${BASE}/api/profile`)).json();
const entry = entries.find((e) => e.concept_name === "矩阵乘法");
check("读取画像", Boolean(entry));
check("衰减生效 0.8 → 0.7", entry && entry.mastery === 0.7, `实际 ${entry?.mastery}`);
check("证据保留", entry && entry.evidence_refs.length === 1);

console.log("\n[3] 手动纠错 + 30 天保护期（AC-04-1）");
let res = await fetch(`${BASE}/api/profile/${entryId}`, {
  method: "PATCH",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ mastery: 0.4 }),
});
let data = await res.json();
check("调整 0.7 → 0.4", data.mastery === 0.4, `实际 ${data.mastery}`);
entries = await (await fetch(`${BASE}/api/profile`)).json();
const after = entries.find((e) => e.id === entryId);
check("source_type 变为 user", after.source_type === "user");
check("保护期已设置（约 30 天）", after.protected_until && new Date(after.protected_until) > new Date());

console.log("\n[4] 变更日志四要素（AC-08-2）");
const logs = await (await fetch(`${BASE}/api/profile/${entryId}/logs`)).json();
check("日志非空", logs.length >= 2);
const editLog = logs.find((l) => l.signal_type === "user_edit");
check("user_edit 含原值/新值", editLog && editLog.old_value === 0.7 && editLog.new_value === 0.4);
const decayLog = logs.find((l) => l.signal_type === "decay");
check("decay 有记录", Boolean(decayLog));

console.log("\n[5] 会话删除级联（AC-01-2 / E-12：笔记保留标记来源删除；证据清零条目移除）");
res = await fetch(`${BASE}/api/conversations/${convId}`, { method: "DELETE" });
check("删除会话成功", res.ok);
const notes = await (await fetch(`${BASE}/api/notes`)).json();
const note = notes.find((n) => n.id === noteId);
check("笔记保留", Boolean(note));
check("笔记标记来源已删除", note && note.status === "source_deleted", `实际 ${note?.status}`);
entries = await (await fetch(`${BASE}/api/profile`)).json();
check("证据清零条目已移除（矩阵乘法）", !entries.some((e) => e.concept_name === "矩阵乘法"));

console.log("\n[6] 无 Key 时对话接口直接 503（不产生孤儿消息）");
res = await fetch(`${BASE}/api/chat`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ conversation_id: convId, content: "测试" }),
});
check("返回 503", res.status === 503);

console.log(`\n========== 结果：${pass} 通过 / ${fail} 失败 ==========`);
process.exit(fail > 0 ? 1 : 0);
