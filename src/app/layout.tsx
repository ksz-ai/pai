import type { Metadata } from "next";
import "./globals.css";
import "katex/dist/katex.min.css";
import { TopNav } from "@/components/common/TopNav";
import { ModelStatusBanner } from "@/components/common/ModelStatusBanner";

export const metadata: Metadata = {
  title: "PAI · 个人 AI 学习应用",
  description: "让 AI 记住你会什么——按你的水平讲解，学完能带走。",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <ModelStatusBanner />
        <TopNav />
        <main className="flex-1 w-full">{children}</main>
      </body>
    </html>
  );
}
