"use client";

import { useCallback, useEffect, useState } from "react";
import type { StatsDTO } from "@/lib/types";
import { jsonFetch } from "@/lib/client/api";
import { PERSONAS } from "@/lib/client/personas";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";

/** 常用服务商预设：选中即自动填地址与推荐模型（PRD 13.1：多供应商可切换） */
const PRESETS: { id: string; label: string; baseUrl: string; models: string[]; keyHint: string }[] = [
  { id: "zhipu", label: "智谱 GLM", baseUrl: "https://open.bigmodel.cn/api/paas/v4", models: ["glm-4-flash", "glm-4-air", "glm-4-plus"], keyHint: "open.bigmodel.cn → API Keys" },
  { id: "deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", models: ["deepseek-chat", "deepseek-reasoner"], keyHint: "platform.deepseek.com → API Keys" },
  { id: "kimi", label: "Kimi（月之暗面）", baseUrl: "https://api.moonshot.cn/v1", models: ["moonshot-v1-8k", "kimi-k2-0711-preview"], keyHint: "platform.moonshot.cn → API Key" },
  { id: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1", models: ["gpt-4o-mini", "gpt-4o"], keyHint: "platform.openai.com → API Keys" },
  { id: "custom", label: "自定义 / 其他兼容服务", baseUrl: "", models: [], keyHint: "任意 OpenAI 兼容服务的 Key" },
];

interface LlmConfigDTO {
  configured: boolean;
  source: "db" | "env" | "none";
  base_url: string;
  model: string;
  fast_model: string;
  backup_model: string;
  api_key_masked: string | null;
  token_budget: number;
  tutor_persona: string;
}

export default function SettingsPage() {
  const [stats, setStats] = useState<StatsDTO | null>(null);
  const [wipeOpen, setWipeOpen] = useState(false);
  const [wipeText, setWipeText] = useState("");

  // ---- 模型配置表单 ----
  const [cfg, setCfg] = useState<LlmConfigDTO | null>(null);
  const [presetId, setPresetId] = useState("zhipu");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [fastModel, setFastModel] = useState("");
  const [backupModel, setBackupModel] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [tokenBudget, setTokenBudget] = useState("60000");
  const [tutorPersona, setTutorPersona] = useState("general");
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    jsonFetch<StatsDTO>("/api/stats").then(setStats).catch(() => {});
    jsonFetch<LlmConfigDTO>("/api/settings/llm")
      .then((d) => {
        setCfg(d);
        setBaseUrl(d.base_url);
        setModel(d.model);
        setFastModel(d.fast_model);
        setBackupModel(d.backup_model);
        setTokenBudget(String(d.token_budget ?? 60000));
        setTutorPersona(d.tutor_persona ?? "general");
        const hit = PRESETS.find((p) => p.baseUrl && p.baseUrl === d.base_url);
        if (hit) setPresetId(hit.id);
        else if (d.source === "none") {
          // 全新配置：默认选中智谱并预填，减少空白起步
          setPresetId("zhipu");
          setBaseUrl(PRESETS[0].baseUrl);
          if (!d.model) setModel(PRESETS[0].models[0]);
        } else setPresetId("custom");
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function switchPreset(id: string) {
    setPresetId(id);
    setSaveMsg(null);
    setTestMsg(null);
    const p = PRESETS.find((x) => x.id === id);
    if (!p) return;
    setBaseUrl(p.baseUrl);
    if (p.models.length > 0 && (!model || !p.models.includes(model))) setModel(p.models[0]);
  }

  /** 校验必填项，返回缺失清单（决定提示文案与是否展开高级区） */
  function missingFields(): string[] {
    const missing: string[] = [];
    if (!baseUrl.trim()) missing.push("服务地址");
    if (!apiKey.trim() && !cfg?.api_key_masked) missing.push("API Key");
    if (!model.trim()) missing.push("模型名");
    return missing;
  }

  async function save() {
    const missing = missingFields();
    if (missing.length > 0) {
      setSaveMsg({ ok: false, text: `还不能保存，请补全：${missing.join("、")}` });
      if (missing.includes("服务地址")) setAdvanced(true);
      return;
    }
    setSaving(true);
    setSaveMsg(null);
    try {
      await jsonFetch("/api/settings/llm", {
        method: "PUT",
        body: JSON.stringify({
          base_url: baseUrl,
          model,
          api_key: apiKey, // 留空保留已存 Key
          fast_model: fastModel,
          backup_model: backupModel,
          token_budget: Number(tokenBudget) || undefined,
          tutor_persona: tutorPersona,
        }),
      });
      setApiKey(""); // 清空输入框，避免明文残留
      setSaveMsg({ ok: true, text: "已保存，配置立即生效，去对话页试试吧 →" });
      load();
    } catch (e) {
      setSaveMsg({ ok: false, text: e instanceof Error ? e.message : "保存失败" });
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    const missing = missingFields();
    if (missing.length > 0) {
      setTestMsg({ ok: false, text: `请先补全：${missing.join("、")}` });
      if (missing.includes("服务地址")) setAdvanced(true);
      return;
    }
    setTesting(true);
    setTestMsg(null);
    try {
      const r = await jsonFetch<{ ok: boolean; message: string }>("/api/settings/llm/test", {
        method: "POST",
        body: JSON.stringify({ base_url: baseUrl, api_key: apiKey, model }),
      });
      setTestMsg({ ok: r.ok, text: r.message });
    } catch (e) {
      setTestMsg({ ok: false, text: e instanceof Error ? e.message : "测试失败" });
    } finally {
      setTesting(false);
    }
  }

  async function exportAll() {
    const dump = await jsonFetch<Record<string, unknown>>("/api/stats", { method: "POST" }).catch(() => null);
    if (!dump) {
      alert("导出失败，请重试");
      return;
    }
    const blob = new Blob([JSON.stringify(dump, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `pai-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function confirmWipe() {
    if (wipeText !== "删除") return;
    await jsonFetch("/api/data", { method: "DELETE" }).catch(() => {});
    setWipeOpen(false);
    setWipeText("");
    load();
  }

  const preset = PRESETS.find((p) => p.id === presetId);
  const configured = cfg?.configured;

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      <div>
        <h1 className="text-xl font-bold text-white">设置</h1>
        <p className="mt-0.5 text-sm text-text3">只需配置一次模型服务，应用即可使用</p>
      </div>

      {/* 模型配置（PRD E-13：设置页配置，保存即生效） */}
      <section className="rounded-xl border border-border bg-panel p-5">
        <div className="mb-4 flex items-center gap-2">
          <h2 className="text-sm font-semibold text-white">模型服务</h2>
          {cfg && (
            <span className={`flex items-center gap-1.5 text-xs ${configured ? "text-accent2" : "text-warn"}`}>
              <span className={`h-2 w-2 rounded-full ${configured ? "bg-accent2" : "bg-warn"}`} />
              {configured ? `已配置（${cfg.source === "db" ? "本页配置" : "环境变量"}）` : "未配置"}
            </span>
          )}
        </div>

        {cfg && !configured && (
          <div className="mb-4 rounded-lg border border-warn/40 bg-warn/10 px-3.5 py-2.5 text-xs leading-relaxed text-warn">
            还没有配置模型，对话功能暂不可用。三步完成：① 选服务商 → ② 粘贴 API Key → ③ 点「保存」。
          </div>
        )}

        <div className="space-y-4">
          {/* 1. 服务商 */}
          <div>
            <label className="mb-1.5 block text-xs text-text2">
              <span className="text-danger">*</span> ① 选择服务商
            </label>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => switchPreset(p.id)}
                  className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                    presetId === p.id
                      ? "border-accent bg-accent/15 text-accent"
                      : "border-border text-text2 hover:border-accent/60 hover:text-text"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {/* 服务地址：主流程常显（预设自动填，自定义可改），不再藏在高级选项里 */}
            <div className="mt-3">
              <label className="mb-1 flex items-center gap-2 text-xs text-text2">
                <span className="text-danger">*</span> 服务地址
                <span className="text-text3">（选服务商自动填入，自定义时手动填写，以 /v1 结尾）</span>
              </label>
              <input
                value={baseUrl}
                onChange={(e) => {
                  setBaseUrl(e.target.value);
                  const hit = PRESETS.find((p) => p.baseUrl === e.target.value);
                  setPresetId(hit ? hit.id : "custom");
                  setSaveMsg(null);
                  setTestMsg(null);
                }}
                placeholder="https://api.example.com/v1"
                className="w-full rounded-md border border-border bg-panel2 px-3 py-1.5 font-mono text-xs text-text focus:border-accent focus:outline-none"
              />
            </div>
          </div>

          {/* 2. API Key */}
          <div>
            <label className="mb-1.5 block text-xs text-text2">
              <span className="text-danger">*</span> ② API Key{" "}
              <span className="text-text3">（获取渠道：{preset?.keyHint}）</span>
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                setSaveMsg(null);
                setTestMsg(null);
              }}
              placeholder={cfg?.api_key_masked ? `已保存 ${cfg.api_key_masked}，留空则不修改` : "粘贴你的 API Key"}
              className="w-full rounded-md border border-border bg-panel2 px-3 py-2 text-sm text-text placeholder:text-text3 focus:border-accent focus:outline-none"
              autoComplete="off"
            />
          </div>

          {/* 3. 模型 */}
          <div>
            <label className="mb-1.5 block text-xs text-text2">
              <span className="text-danger">*</span> ③ 模型
            </label>
            <div className="flex flex-wrap gap-2">
              {(preset?.models ?? []).map((m) => (
                <button
                  key={m}
                  onClick={() => {
                    setModel(m);
                    setSaveMsg(null);
                    setTestMsg(null);
                  }}
                  className={`rounded-md border px-2.5 py-1 font-mono text-xs transition-colors ${
                    model === m ? "border-accent bg-accent/15 text-accent" : "border-border text-text2 hover:text-text"
                  }`}
                >
                  {m}
                </button>
              ))}
              <input
                value={model}
                onChange={(e) => {
                  setModel(e.target.value);
                  setSaveMsg(null);
                  setTestMsg(null);
                }}
                placeholder={preset?.models.length ? "或直接输入模型名" : "填写模型名，如 glm-4-flash"}
                className="min-w-[220px] flex-1 rounded-md border border-border bg-panel2 px-3 py-1.5 font-mono text-xs text-text placeholder:text-text3 focus:border-accent focus:outline-none"
              />
            </div>
          </div>

          {/* 高级 */}
          <div>
            <button onClick={() => setAdvanced((v) => !v)} className="text-xs text-text3 hover:text-text2">
              {advanced ? "收起高级选项 ▲" : "高级选项（抽取模型 / 备用模型）▼"}
            </button>
            {advanced && (
              <div className="mt-3 space-y-3 rounded-lg bg-panel2/50 p-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs text-text2">概念抽取模型（可选，小快模型）</label>
                    <input
                      value={fastModel}
                      onChange={(e) => setFastModel(e.target.value)}
                      placeholder="留空使用主模型"
                      className="w-full rounded-md border border-border bg-panel2 px-3 py-1.5 font-mono text-xs text-text focus:border-accent focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-text2">备用模型（可选，主模型故障时切换）</label>
                    <input
                      value={backupModel}
                      onChange={(e) => setBackupModel(e.target.value)}
                      placeholder="留空不启用"
                      className="w-full rounded-md border border-border bg-panel2 px-3 py-1.5 font-mono text-xs text-text focus:border-accent focus:outline-none"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 成本控制 */}
          <div className="border-t border-border/60 pt-4">
            <label className="mb-1.5 block text-xs text-text2">
              单会话 Token 预算 <span className="text-text3">（达到 80% 自动压缩上下文，超出 100% 拦截新调用；默认 60,000）</span>
            </label>
            <input
              type="number"
              value={tokenBudget}
              min={5000}
              max={1000000}
              step={5000}
              onChange={(e) => setTokenBudget(e.target.value)}
              className="w-44 rounded-md border border-border bg-panel2 px-3 py-2 text-sm tabular-nums text-text focus:border-accent focus:outline-none"
            />
            <p className="mt-1 text-[11px] text-text3">与「保存配置」一起生效；预算是控制成本的上限护栏，不是精确计费</p>
          </div>

          {/* 讲解语气（融合批次 F1：Grok persona 启发） */}
          <div className="border-t border-border/60 pt-4">
            <label className="mb-1.5 block text-xs text-text2">
              讲解语气 <span className="text-text3">（与深度档叠加；切换后下一条讲解生效）</span>
            </label>
            <div className="grid gap-2 sm:grid-cols-2">
              {PERSONAS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    setTutorPersona(p.id);
                    setSaveMsg(null);
                  }}
                  className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                    tutorPersona === p.id ? "border-accent bg-accent/10" : "border-border hover:border-accent/60"
                  }`}
                >
                  <p className={`text-xs font-medium ${tutorPersona === p.id ? "text-accent" : "text-text"}`}>
                    {tutorPersona === p.id ? "● " : "○ "}
                    {p.label}
                  </p>
                  <p className="mt-0.5 text-[11px] leading-snug text-text3">{p.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* 操作与反馈 */}
          <div className="flex flex-wrap items-center gap-3 border-t border-border/60 pt-4">
            <button
              onClick={save}
              disabled={saving}
              className="rounded-md bg-accent px-5 py-2 text-sm font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {saving ? "保存中…" : "保存配置"}
            </button>
            <button
              onClick={testConnection}
              disabled={testing}
              className="rounded-md border border-border px-4 py-2 text-sm text-text2 transition-colors hover:border-accent hover:text-accent disabled:opacity-40"
            >
              {testing ? "测试中…" : "测试连接"}
            </button>
            {saveMsg && <span className={`text-xs ${saveMsg.ok ? "text-accent2" : "text-danger"}`}>{saveMsg.text}</span>}
            {testMsg && <span className={`text-xs ${testMsg.ok ? "text-accent2" : "text-warn"}`}>{testMsg.text}</span>}
          </div>

          {cfg?.configured && cfg.source === "env" && (
            <p className="text-xs leading-relaxed text-text3">
              当前生效配置来自环境变量（.env.local）。在此页保存后将以本页配置为准。
            </p>
          )}
        </div>
      </section>

      {/* 学习面板（PRD §13.3 最小数据能力） */}
      <section className="rounded-xl border border-border bg-panel p-5">
        <h2 className="mb-3 text-sm font-semibold text-white">学习面板</h2>
        {stats ? (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat
                label="本周闭环"
                value={String(stats.week_closures)}
                hint="本周完成「提问→笔记」的会话（北极星指标，目标 ≥3/周）"
              />
              <Stat label="画像知识点" value={String(stats.profile_entries)} />
              <Stat label="笔记" value={String(stats.note_count)} />
              <Stat
                label="单会话均成本"
                value={stats.avg_session_cost !== null ? `¥${stats.avg_session_cost.toFixed(2)}` : "—"}
                hint={stats.cost_estimate !== null ? `累计 ¥${stats.cost_estimate.toFixed(2)}` : "未配置单价"}
              />
              <Stat label="输入 tokens" value={stats.token_in.toLocaleString()} />
              <Stat label="输出 tokens" value={stats.token_out.toLocaleString()} />
              <Stat label="总会话" value={String(stats.total_conversations)} />
            </div>
            {stats.domain_distribution.length > 0 && (
              <div className="mt-4">
                <p className="mb-1.5 text-xs text-text3">画像领域分布</p>
                <div className="flex flex-wrap gap-2">
                  {stats.domain_distribution.map((d) => (
                    <span key={d.domain} className="rounded-md border border-border bg-panel2/60 px-2.5 py-1 text-xs text-text2">
                      {d.domain} <span className="font-medium text-accent">{d.count}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-text3">加载中…</p>
        )}
      </section>

      {/* 数据管理 */}
      <section className="rounded-xl border border-border bg-panel p-5">
        <h2 className="mb-3 text-sm font-semibold text-white">数据管理</h2>
        <p className="mb-3 text-xs leading-relaxed text-text3">
          你的所有数据（会话、笔记、画像）存储在本地 SQLite 文件中，随时可以带走或彻底删除。
        </p>
        <div className="flex gap-2">
          <button
            onClick={exportAll}
            className="rounded-md border border-border px-4 py-2 text-sm text-text2 hover:border-accent hover:text-accent"
          >
            导出全部数据（JSON）
          </button>
          <button
            onClick={() => setWipeOpen(true)}
            className="rounded-md border border-danger/50 px-4 py-2 text-sm text-danger hover:bg-danger/10"
          >
            彻底删除全部数据
          </button>
        </div>
      </section>

      <ConfirmDialog
        open={wipeOpen}
        title="彻底删除全部数据？"
        message="将删除所有会话、消息、笔记、画像及使用记录（模型配置保留），且不可恢复。请先导出备份。"
        confirmText="永久删除"
        danger
        onConfirm={confirmWipe}
        onCancel={() => {
          setWipeOpen(false);
          setWipeText("");
        }}
      >
        <input
          value={wipeText}
          onChange={(e) => setWipeText(e.target.value)}
          placeholder='输入「删除」以确认'
          className="mt-3 w-full rounded-md border border-border bg-panel2 px-3 py-2 text-sm text-text focus:border-danger focus:outline-none"
        />
      </ConfirmDialog>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg bg-panel2/60 px-3.5 py-2.5">
      <p className="text-lg font-semibold text-white">{value}</p>
      <p className="text-xs text-text3">{label}</p>
      {hint && <p className="text-[11px] text-text3">{hint}</p>}
    </div>
  );
}
