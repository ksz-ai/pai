"use client";

import type { ReactNode } from "react";

/** 轻量确认弹窗（FR-02 ④ 重生成/删除等二次确认） */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmText = "确认",
  danger,
  onConfirm,
  onCancel,
  children,
}: {
  open: boolean;
  title: string;
  message?: string;
  confirmText?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onCancel}>
      <div
        className="w-full max-w-md rounded-xl border border-border bg-panel p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-white">{title}</h3>
        {message && <p className="mt-2 text-sm leading-relaxed text-text2">{message}</p>}
        {children}
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-md border border-border px-3.5 py-1.5 text-sm text-text2 hover:bg-panel2"
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            className={`rounded-md px-3.5 py-1.5 text-sm font-medium ${
              danger ? "bg-danger/90 text-white hover:bg-danger" : "bg-accent text-bg hover:opacity-90"
            }`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
