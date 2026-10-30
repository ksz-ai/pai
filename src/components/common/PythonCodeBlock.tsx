"use client";

import { useEffect, useRef, useState } from "react";
import { pyodideRunner } from "@/lib/pyodide/runner";

/**
 * 可执行 Python 代码卡片（SPEC M2-1）：
 * ▶ 运行（Pyodide 沙箱）/ 编辑改代码重跑 / stdout 实时输出 / matplotlib 图表内嵌。
 */
export function PythonCodeBlock({ code: initialCode }: { code: string }) {
  const [code, setCode] = useState(initialCode);
  const [original] = useState(initialCode);
  const [editing, setEditing] = useState(false);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [output, setOutput] = useState<string[]>([]);
  const [images, setImages] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const outRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  // 出现代码卡片 → 大概率要运行：静默预热 Pyodide 运行时（幂等，首次约 10MB）
  useEffect(() => {
    pyodideRunner.warmup();
  }, []);

  function run() {
    if (running || !code.trim()) return;
    setRunning(true);
    setStatus("准备运行时…");
    setOutput([]);
    setImages([]);
    setError(null);
    setElapsed(0);
    timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    pyodideRunner.run(code, {
      onStatus: (msg) => setStatus(msg),
      onStdout: (text) => setOutput((prev) => [...prev, text]),
      onDone: (result) => {
        if (timerRef.current) clearInterval(timerRef.current);
        setRunning(false);
        setStatus(null);
        setImages(result.images);
        if (!result.ok) setError(result.error ?? "运行出错");
        if (result.timedOut) setStatus("已超时终止");
      },
    });
  }

  return (
    <div className="my-3 overflow-hidden rounded-xl border border-border bg-[#0b0e14]">
      {/* 标题栏 */}
      <div className="flex items-center gap-2 border-b border-border bg-panel2/70 px-3 py-1.5">
        <span className="font-mono text-[11px] text-text3">🐍 python</span>
        <div className="ml-auto flex items-center gap-2">
          {running ? (
            <span className="flex items-center gap-1.5 text-[11px] text-warn">
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-border border-t-warn" />
              {status ?? "运行中…"} {elapsed > 0 && `${elapsed}s`}
            </span>
          ) : (
            <>
              <button
                onClick={() => setEditing((v) => !v)}
                className="rounded px-2 py-0.5 text-[11px] text-text3 transition-colors hover:text-accent"
              >
                {editing ? "完成编辑" : "编辑"}
              </button>
              {editing && code !== original && (
                <button onClick={() => setCode(original)} className="rounded px-2 py-0.5 text-[11px] text-text3 hover:text-text2">
                  还原
                </button>
              )}
              <button
                onClick={run}
                className="rounded bg-accent2/20 px-2.5 py-0.5 text-[11px] font-medium text-accent2 transition-colors hover:bg-accent2/30"
              >
                ▶ 运行
              </button>
            </>
          )}
        </div>
      </div>

      {/* 代码区（编辑态为 textarea） */}
      {editing ? (
        <textarea
          value={code}
          onChange={(e) => setCode(e.target.value)}
          spellCheck={false}
          rows={Math.max(4, code.split("\n").length + 1)}
          className="w-full resize-y bg-transparent px-3.5 py-3 font-mono text-[13px] leading-relaxed text-[#d6deeb] focus:outline-none"
        />
      ) : (
        <pre className="overflow-x-auto px-3.5 py-3 font-mono text-[13px] leading-relaxed text-[#d6deeb]">
          <code>{code}</code>
        </pre>
      )}

      {/* 输出区 */}
      {(output.length > 0 || images.length > 0 || error) && (
        <div ref={outRef} className="border-t border-border/70">
          {output.length > 0 && (
            <pre className="max-h-60 overflow-auto px-3.5 py-2.5 font-mono text-[12px] leading-relaxed text-text2">
              {output.join("")}
            </pre>
          )}
          {images.map((b64, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={`data:image/png;base64,${b64}`} alt={`图表 ${i + 1}`} className="block w-full bg-white" />
          ))}
          {error && (
            <pre className="overflow-auto px-3.5 py-2.5 font-mono text-[12px] leading-relaxed text-danger">{error}</pre>
          )}
        </div>
      )}
    </div>
  );
}
