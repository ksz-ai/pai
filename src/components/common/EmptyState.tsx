import type { ReactNode } from "react";

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-panel/40 px-6 py-16 text-center">
      <div className="mb-3 text-3xl opacity-60">📝</div>
      <p className="text-base font-medium text-text">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-sm text-text3">{hint}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-text3">
      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-border border-t-accent" />
      {label}
    </span>
  );
}
