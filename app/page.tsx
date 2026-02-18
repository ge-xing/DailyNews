import Link from "next/link";
import { getAllReports, type ReportChannel } from "@/lib/reports";
import { getGithubTrending } from "@/lib/trending";
import { HotspotYoutubeSearch } from "@/components/hotspot-youtube-search";
import { SidebarTabs } from "@/components/sidebar-tabs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type HomeProps = {
  searchParams: Promise<{ tab?: string; category?: string }>;
};

type TabKey = "ai" | "crypto" | "github" | "daily" | "hot";

type DailyCategoryKey =
  | "macro_policy"
  | "markets_assets"
  | "companies_industry"
  | "global_general_news"
  | "tech_business"
  | "crypto_digital_assets";

const DAILY_CATEGORY_ITEMS: Array<{ key: DailyCategoryKey; label: string; tokens: string[] }> = [
  { key: "macro_policy", label: "宏观政策", tokens: ["宏观政策", "macro_policy"] },
  { key: "markets_assets", label: "市场资产", tokens: ["市场资产", "markets_assets"] },
  { key: "companies_industry", label: "公司产业", tokens: ["公司产业", "companies_industry"] },
  { key: "global_general_news", label: "全球要闻", tokens: ["全球要闻", "global_general_news"] },
  { key: "tech_business", label: "科技商业", tokens: ["科技商业", "tech_business"] },
  { key: "crypto_digital_assets", label: "加密资产", tokens: ["加密资产", "crypto_digital_assets"] },
];

const HERO_COPY: Record<TabKey, { kicker: string; title: string; subtitle: string }> = {
  ai: {
    kicker: "Karpathy Curated RSS",
    title: "Your AI Intelligence Hub.",
    subtitle: "聚合高质量 AI 来源，形成可连续追踪的日报与主题线索。",
  },
  crypto: {
    kicker: "Crypto RSS Feed",
    title: "Your Crypto Market Desk.",
    subtitle: "覆盖行情脉冲、叙事变化与关键项目动态，保持同一视角持续观察。",
  },
  daily: {
    kicker: "Daily Information",
    title: "Your Daily Macro Console.",
    subtitle: "把宏观、行业与科技商业放在同一界面，快速建立全局认知。",
  },
  github: {
    kicker: "Search1API · Github Trending",
    title: "Your Github Trend Radar.",
    subtitle: "实时捕捉仓库热度变化，并提供双语摘要便于快速判断价值。",
  },
  hot: {
    kicker: "Youtube Hotspot Search",
    title: "Your Realtime Video Signals.",
    subtitle: "关键词驱动热点检索，定位高时效内容与热度变化。",
  },
};

function normalizeTab(tab?: string): TabKey {
  if (tab === "hot") return "hot";
  if (tab === "github") return "github";
  if (tab === "daily") return "daily";
  if (tab === "finance") return "daily";
  if (tab === "crypto") return "crypto";
  return "ai";
}

function normalizeDailyCategory(category?: string): DailyCategoryKey | undefined {
  if (!category) return undefined;
  return DAILY_CATEGORY_ITEMS.some((it) => it.key === category) ? (category as DailyCategoryKey) : undefined;
}

function resolveDailyCategory(report: { title: string; fileName: string }): DailyCategoryKey | undefined {
  const haystack = `${report.title} ${report.fileName}`;
  for (const item of DAILY_CATEGORY_ITEMS) {
    if (item.tokens.some((token) => haystack.includes(token))) {
      return item.key;
    }
  }
  return undefined;
}

export default async function Home({ searchParams }: HomeProps) {
  const params = await searchParams;
  const activeTab = normalizeTab(params.tab);
  const activeReportChannel: ReportChannel | null =
    activeTab === "daily" ? "finance" : activeTab === "ai" || activeTab === "crypto" ? activeTab : null;
  const selectedDailyCategory = activeTab === "daily" ? normalizeDailyCategory(params.category) : undefined;

  const allReports = activeReportChannel ? await getAllReports(activeReportChannel) : [];
  const reports =
    activeTab === "daily" && selectedDailyCategory
      ? allReports.filter((report) => resolveDailyCategory(report) === selectedDailyCategory)
      : allReports;
  const trending = activeTab === "github" ? await getGithubTrending(20) : null;

  const latest = reports[0];

  const dailyCategoryCounts = new Map<DailyCategoryKey, number>();
  for (const item of DAILY_CATEGORY_ITEMS) {
    dailyCategoryCounts.set(item.key, 0);
  }
  if (activeTab === "daily") {
    for (const report of allReports) {
      const key = resolveDailyCategory(report);
      if (!key) continue;
      dailyCategoryCounts.set(key, (dailyCategoryCounts.get(key) || 0) + 1);
    }
  }

  const reportLinkQuery =
    activeTab === "daily"
      ? selectedDailyCategory
        ? `?tab=daily&category=${encodeURIComponent(selectedDailyCategory)}`
        : "?tab=daily"
      : activeReportChannel
        ? `?tab=${activeReportChannel}`
        : "";

  const featuredReports = reports.slice(0, 2);
  const hero = HERO_COPY[activeTab];

  const issueCount =
    activeTab === "github"
      ? trending?.items.length || 0
      : activeTab === "hot"
        ? 30
        : reports.length || allReports.length || 0;
  const issueLabel = `VOL. ${String(issueCount).padStart(3, "0")}`;

  return (
    <main className="neo-home">
      <div className="neo-shell">
        <aside className="neo-sidebar">
          <p className="neo-side-section">Explore</p>
          <SidebarTabs activeTab={activeTab} />

          <p className="neo-side-section">Connect</p>
          <div className="neo-connect-list">
            <a href="https://github.com" target="_blank" rel="noreferrer" className="neo-connect-link">
              Github
            </a>
            <a href="https://www.youtube.com" target="_blank" rel="noreferrer" className="neo-connect-link">
              YouTube
            </a>
          </div>
        </aside>

        <section className="neo-content">
          <header className="neo-hero">
            <p className="neo-kicker">{hero.kicker}</p>
            <h1>{hero.title}</h1>
            <p className="neo-subtitle">{hero.subtitle}</p>
            <div className="neo-hero-actions">
              {activeReportChannel && latest ? (
                <Link className="neo-btn is-primary" href={`/reports/${latest.slug}${reportLinkQuery}`}>
                  阅读最新一期
                </Link>
              ) : (
                <Link className="neo-btn is-primary" href={activeTab === "github" ? "/?tab=github" : "/?tab=ai"}>
                  {activeTab === "github" ? "刷新趋势" : "返回 AI 日报"}
                </Link>
              )}
              <span className="neo-pill">{issueLabel}</span>
            </div>
          </header>

          {activeTab === "daily" ? (
            <section className="category-strip" aria-label="每日资讯分类">
              <Link href="/?tab=daily" className={`category-pill ${!selectedDailyCategory ? "is-active" : ""}`}>
                全部 ({allReports.length})
              </Link>
              {DAILY_CATEGORY_ITEMS.map((item) => (
                <Link
                  key={item.key}
                  href={`/?tab=daily&category=${encodeURIComponent(item.key)}`}
                  className={`category-pill ${selectedDailyCategory === item.key ? "is-active" : ""}`}
                >
                  {item.label} ({dailyCategoryCounts.get(item.key) || 0})
                </Link>
              ))}
            </section>
          ) : null}

          <div className="neo-content-body">
            {activeTab === "hot" ? (
              <HotspotYoutubeSearch />
            ) : activeTab === "github" ? (
              <>
                <section className="grid-head">
                  <h2>Trending Repositories</h2>
                  <p>{trending?.items.length ? `共 ${trending.items.length} 条` : "暂无趋势数据"}</p>
                </section>

                {trending?.warning ? (
                  <section className="empty-card">
                    <p>Gemini 翻译部分失败，已展示英文原文。</p>
                    <p>{trending.warning}</p>
                  </section>
                ) : null}

                {trending?.error ? (
                  <section className="empty-card">
                    <p>获取 Github 趋势失败。</p>
                    <p>{trending.error}</p>
                  </section>
                ) : trending && trending.items.length > 0 ? (
                  <section className="trend-list">
                    {trending.items.map((item) => (
                      <article key={item.id} className="trend-item">
                        <div className="trend-head">
                          <p className="trend-rank">#{item.rank}</p>
                        </div>
                        <h3 className="trend-title">
                          {item.url ? (
                            <a href={item.url} target="_blank" rel="noreferrer">
                              {item.title}
                            </a>
                          ) : (
                            item.title
                          )}
                        </h3>
                        <p className="trend-summary-en">{item.summaryEn || "No English summary."}</p>
                        <p className="trend-summary-zh">{item.summaryZh || "中文翻译暂不可用。"}</p>
                        <div className="report-meta">
                          {item.language ? <span>{item.language}</span> : null}
                          {item.stars ? <span>Stars {item.stars}</span> : null}
                          {item.forks ? <span>Forks {item.forks}</span> : null}
                        </div>
                      </article>
                    ))}
                  </section>
                ) : (
                  <section className="empty-card">
                    <p>当前没有可展示的 Github 趋势数据。</p>
                    <p>请确认已配置 `SEARCH1_API_KEY`，然后刷新本页。</p>
                  </section>
                )}
              </>
            ) : (
              <>
                <section className="neo-section-head">
                  <h2>New Drops</h2>
                </section>

                {featuredReports.length > 0 ? (
                  <section className="neo-drop-grid">
                    {featuredReports.map((report) => (
                      <Link key={report.slug} className="neo-drop-card" href={`/reports/${report.slug}${reportLinkQuery}`}>
                        <div className="neo-drop-media">
                          <span>{activeTab === "crypto" ? "CRYPTO" : activeTab === "daily" ? "DAILY" : "AI"}</span>
                        </div>
                        <div className="neo-drop-body">
                          <h3>{report.title}</h3>
                          <p>{report.excerpt}</p>
                          <div className="neo-drop-meta">
                            <span>{report.date}</span>
                            <span>{report.itemCount > 0 ? `${report.itemCount} 条` : "待统计"}</span>
                          </div>
                        </div>
                      </Link>
                    ))}
                  </section>
                ) : null}

                <section className="grid-head">
                  <h2>Report Archive</h2>
                  <p>{reports.length > 0 ? `共 ${reports.length} 期` : "暂无日报，请点击按钮生成。"}</p>
                </section>

                {reports.length === 0 ? (
                  <section className="empty-card">
                    <p>当前没有可展示的日报文件。</p>
                    <p>请在本地生成并上传到 OSS 后刷新页面。</p>
                  </section>
                ) : (
                  <section className="report-grid">
                    {reports.map((report) => (
                      <Link key={report.slug} className="report-card" href={`/reports/${report.slug}${reportLinkQuery}`}>
                        <p className="report-date">{report.date}</p>
                        <h3>{report.title}</h3>
                        <p className="report-excerpt">{report.excerpt}</p>
                        <div className="report-meta">
                          <span>{report.itemCount > 0 ? `${report.itemCount} 条更新` : "待统计"}</span>
                          <span>{report.themeCount > 0 ? `${report.themeCount} 个主题` : "待统计"}</span>
                        </div>
                        <span className="card-link">打开全文</span>
                      </Link>
                    ))}
                  </section>
                )}
              </>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
