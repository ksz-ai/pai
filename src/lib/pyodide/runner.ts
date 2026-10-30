"use client";

/**
 * Pyodide 运行管理器（SPEC M2-1）：主线程单例，持有 worker、消息分发、30s 超时熔断。
 * 超时 → terminate worker → 下次运行自动重建（重载运行时的代价由用户感知并接受）。
 */

export interface RunHandlers {
  onStatus?: (msg: string) => void;
  onStdout?: (text: string) => void;
  onDone: (result: { ok: boolean; images: string[]; error?: string; timedOut?: boolean }) => void;
}

/** 成功执行的用户代码的熔断时长（死循环判定，仅覆盖"代码执行"阶段） */
const EXEC_TIMEOUT_MS = 30_000;
/** 环境准备（运行时 + 依赖包下载 install）兜底；不与执行超时混淆，避免弱网误判死循环 */
const ENV_TIMEOUT_MS = 180_000;

type PendingEntry = {
  handlers: RunHandlers;
  envTimer: ReturnType<typeof setTimeout> | null;
  execTimer: ReturnType<typeof setTimeout> | null;
};

/** Worker 脚本版本：public 文件无 hash，bump 此参数强制浏览器取新版本 */
const WORKER_URL = "/pyodide-worker.js?v=20261030-exec-split";

class PyodideRunner {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, PendingEntry>();
  private initStarted = false;

  private clearTimers(entry: PendingEntry) {
    if (entry.envTimer) clearTimeout(entry.envTimer);
    if (entry.execTimer) clearTimeout(entry.execTimer);
    entry.envTimer = null;
    entry.execTimer = null;
  }

  /** 熔断：同步执行无法抢占，终止 worker，下次运行重建 */
  private kill(cause: "env" | "exec") {
    this.worker?.terminate();
    this.worker = null;
    this.initStarted = false;
    for (const [, p] of this.pending) {
      this.clearTimers(p);
      p.handlers.onDone({
        ok: false,
        images: [],
        timedOut: true,
        error:
          cause === "exec"
            ? `运行超时（${EXEC_TIMEOUT_MS / 1000}s），已终止。可能是死循环——检查终止条件后重试（运行时将重新加载）。`
            : `环境准备超时（${ENV_TIMEOUT_MS / 1000}s）：首次运行需下载运行时与依赖包，网络较慢会触发。已重置运行时，请重试（缓存的下载内容不会重复传输）。`,
      });
    }
    this.pending.clear();
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const w = new Worker(WORKER_URL);
    w.onmessage = (e: MessageEvent) => {
      const msg = e.data as { type: string; id?: number; msg?: string; text?: string; ok?: boolean; images?: string[]; error?: string };
      if (msg.type === "status") {
        for (const p of this.pending.values()) p.handlers.onStatus?.(msg.msg ?? "");
        return;
      }
      if (msg.type === "stdout" && msg.id != null) {
        this.pending.get(msg.id)?.handlers.onStdout?.(msg.text ?? "");
        return;
      }
      if (msg.type === "exec") {
        // 环境准备完成 → 代码开始执行：切换为执行熔断计时
        for (const [, p] of this.pending) {
          if (p.envTimer) {
            clearTimeout(p.envTimer);
            p.envTimer = null;
            p.execTimer = setTimeout(() => this.kill("exec"), EXEC_TIMEOUT_MS);
          }
        }
        return;
      }
      if (msg.type === "result" && msg.id != null) {
        const entry = this.pending.get(msg.id);
        if (!entry) return;
        this.clearTimers(entry);
        this.pending.delete(msg.id);
        entry.handlers.onDone({ ok: Boolean(msg.ok), images: msg.images ?? [], error: msg.error });
      }
    };
    w.onerror = () => {
      // worker 崩溃：通知所有在途任务并重置
      for (const [, p] of this.pending) {
        this.clearTimers(p);
        p.handlers.onDone({ ok: false, images: [], error: "Python 运行时崩溃，请重试" });
      }
      this.pending.clear();
      this.worker = null;
    };
    this.worker = w;
    this.initStarted = false;
    return w;
  }

  /** 预热：提前加载运行时（如页面进入时静默 init） */
  warmup() {
    const w = this.ensureWorker();
    if (!this.initStarted) {
      this.initStarted = true;
      w.postMessage({ type: "init" });
    }
  }

  run(code: string, handlers: RunHandlers) {
    const w = this.ensureWorker();
    if (!this.initStarted) {
      this.initStarted = true;
      w.postMessage({ type: "init" });
    }
    const id = ++this.seq;
    const entry: PendingEntry = { handlers, envTimer: null, execTimer: null };
    entry.envTimer = setTimeout(() => this.kill("env"), ENV_TIMEOUT_MS);
    this.pending.set(id, entry);
    w.postMessage({ type: "run", id, code });
  }
}

export const pyodideRunner = new PyodideRunner();
