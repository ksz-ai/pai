"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "对话" },
  { href: "/notes", label: "笔记" },
  { href: "/profile", label: "画像" },
  { href: "/settings", label: "设置" },
] as const;

export function TopNav() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-bg/90 backdrop-blur">
      <div className="mx-auto flex h-12 max-w-6xl items-center gap-6 px-4">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent text-xs font-bold text-bg">
            P
          </span>
          <span className="text-sm font-semibold tracking-wide">PAI</span>
          <span className="hidden text-xs text-text3 sm:inline">个人 AI 学习应用</span>
        </Link>
        <nav className="flex items-center gap-1">
          {links.map((l) => {
            const active =
              l.href === "/" ? pathname === "/" || pathname.startsWith("/chat") : pathname.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                  active ? "bg-panel2 text-white" : "text-text2 hover:bg-panel2/60 hover:text-text"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
