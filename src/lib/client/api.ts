"use client";

import type { SSEEvent } from "@/lib/types";

/** POST + 读取 SSE 流（对话/重生成共用） */
export async function postSSE(
  url: string,
  body: unknown,
  onEvent: (ev: SSEEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const err = (await res.json().catch(() => ({ error: "请求失败" }))) as { error?: string };
    onEvent({ type: "error", code: "http_error", message: err.error ?? `请求失败（${res.status}）` });
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      for (const line of part.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        try {
          onEvent(JSON.parse(trimmed.slice(5).trim()) as SSEEvent);
        } catch {
          /* 跳过坏帧 */
        }
      }
    }
  }
}

export async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `请求失败（${res.status}）`);
  return data;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return "刚刚";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`;
  if (diff < 7 * 86400_000) return `${Math.floor(diff / 86400_000)} 天前`;
  return d.toLocaleDateString("zh-CN");
}

/**
 * 桌面完成通知（融合批次 F1，Muse background tasks 启发）：
 * 长任务完成且用户已切走标签页时提醒；权限未授予则静默跳过。
 */
export function notifyDone(title: string, body: string) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (!document.hidden || Notification.permission !== "granted") return;
  try {
    const n = new Notification(title, { body });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    /* 通知失败不影响主流程 */
  }
}

/** 首次长任务前的惰性权限请求（需在用户手势内调用） */
export function requestNotifyPermission() {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission === "default") void Notification.requestPermission();
}
