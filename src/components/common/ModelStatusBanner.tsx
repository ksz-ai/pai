"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

/**
 * E-13：服务端未配置模型 Key 时，页面顶部常驻提示。
 */
export function ModelStatusBanner() {
  const [checked, setChecked] = useState(true);
  const [configured, setConfigured] = useState(true);

  useEffect(() => {
    let alive = true;
    fetch("/api/health")
      .then((r) => r.json())
      .then((d: { modelConfigured?: boolean }) => {
        if (alive) {
          setConfigured(Boolean(d.modelConfigured));
          setChecked(true);
        }
      })
      .catch(() => {
        /* 健康检查失败不打扰用户 */
      });
    return () => {
      alive = false;
    };
  }, []);

  if (checked && !configured) {
    return (
      <div className="border-b border-warn/40 bg-warn/10 px-4 py-2 text-center text-sm text-warn">
        还差一步：请前往
        <Link href="/settings" className="mx-1 font-medium underline underline-offset-2">
          设置页
        </Link>
        选择模型服务商并粘贴 API Key，保存后即可开始对话。
      </div>
    );
  }
  return null;
}
