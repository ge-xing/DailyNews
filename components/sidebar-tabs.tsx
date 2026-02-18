"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type TabKey = "ai" | "crypto" | "github" | "daily" | "hot";

type SidebarTabsProps = {
  activeTab: TabKey;
};

const SIDEBAR_TABS: Array<{ key: TabKey; label: string; href: string }> = [
  { key: "ai", label: "AI 日报", href: "/?tab=ai" },
  { key: "crypto", label: "币圈日报", href: "/?tab=crypto" },
  { key: "daily", label: "每日资讯", href: "/?tab=daily" },
  { key: "github", label: "Github 趋势", href: "/?tab=github" },
  { key: "hot", label: "发现热点", href: "/?tab=hot" },
];

export function SidebarTabs({ activeTab }: SidebarTabsProps) {
  const router = useRouter();
  const [pendingTab, setPendingTab] = useState<TabKey | null>(null);
  const [isPending, startTransition] = useTransition();

  const showGithubLoading = pendingTab === "github" && isPending;

  function onTabClick(key: TabKey, href: string) {
    if (key === activeTab) return;
    setPendingTab(key);
    startTransition(() => {
      router.push(href);
    });
  }

  return (
    <>
      <nav className="neo-side-nav" aria-label="首页分栏">
        {SIDEBAR_TABS.map((item, idx) => {
          const isActive = activeTab === item.key;
          const isLoading = pendingTab === item.key && isPending;

          return (
            <button
              key={item.key}
              type="button"
              className={`neo-side-link ${isActive ? "is-active" : ""}`}
              onClick={() => onTabClick(item.key, item.href)}
              disabled={isLoading}
              aria-current={isActive ? "page" : undefined}
            >
              <span>{item.label}</span>
              <span className="neo-side-index">{isLoading ? "..." : idx + 1}</span>
            </button>
          );
        })}
      </nav>
      <p className={`neo-loading-tip ${showGithubLoading ? "is-visible" : ""}`} role="status" aria-live="polite">
        正在加载 Github 趋势...
      </p>
    </>
  );
}
