"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { isValidElement, type ReactNode } from "react";
import { Diagram } from "@/lib/diagram/Diagram";
import { PythonCodeBlock } from "@/components/common/PythonCodeBlock";
import { hideStreamingFence } from "@/lib/diagram/markdown";

/**
 * 模型输出的数学公式分隔符不统一：标准 $...$ / $$...$$ 之外，
 * 常见 \(...\) 与 \[...\]（remark-math 不识别）。先归一化再渲染。
 * 附加：流式中未闭合的 diagram / python 围栏 → 占位行，避免未闭合围栏吞掉后续正文。
 */
function normalizeMathDelimiters(md: string): string {
  return hideStreamingFence(
    md
      .replace(/\\\[([\s\S]*?)\\\]/g, (_m, inner: string) => `\n$$${inner}$$\n`)
      .replace(/\\\(([\s\S]*?)\\\)/g, (_m, inner: string) => `$${inner}$`)
      // 苏格拉底复盘标记行 → 醒目标题
      .replace(/^【学习复盘】\s*$/m, "## 🎓 学习复盘"),
  );
}

/** 从 react-markdown 传入的 children 里取第一个子元素与纯文本 */
function firstChild(children: ReactNode): ReactNode {
  return Array.isArray(children) ? children[0] : children;
}

function childClassOf(node: ReactNode): string {
  if (isValidElement(node)) {
    const cls = (node.props as { className?: unknown }).className;
    if (typeof cls === "string") return cls;
  }
  return "";
}

function flattenText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(flattenText).join("");
  if (isValidElement(node)) return flattenText((node.props as { children?: ReactNode }).children);
  return "";
}

const markdownComponents = {
  // 特殊代码围栏 → 专用渲染器；其余代码块维持原样
  pre: (props: { children?: ReactNode }) => {
    const child = firstChild(props.children);
    const cls = childClassOf(child);
    if (cls.includes("language-diagram")) {
      return <Diagram raw={flattenText(child)} />;
    }
    if (cls.includes("language-python")) {
      return <PythonCodeBlock code={flattenText(child)} />;
    }
    return <pre>{props.children}</pre>;
  },
};

export function Markdown({ children, className = "" }: { children: string; className?: string }) {
  return (
    <div className={`md-body ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false, output: "html" }]]}
        components={markdownComponents}
      >
        {normalizeMathDelimiters(children)}
      </ReactMarkdown>
    </div>
  );
}
