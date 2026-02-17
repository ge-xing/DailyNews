import Link from "next/link";
import { getAllReports, type ReportChannel } from "@/lib/reports";
import { getGithubTrending } from "@/lib/trending";
import { HotspotYoutubeSearch } from "@/components/hotspot-youtube-search";

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

type ReportTabConfig = {
  tabLabel: string;
  heroKicker: string;
  heroTitle: string;
  heroGlow: string;
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

function getReportTabConfig(channel: ReportChannel): ReportTabConfig {
  if (channel === "crypto") {
    return {
      tabLabel: "币圈日报",
      heroKicker: "Crypto RSS Feed",
      heroTitle: "币圈日报",
      heroGlow: " Market Brief",
    };
  }

  return {
    tabLabel: "AI日报",
    heroKicker: "Karpathy Curated RSS",
    heroTitle: "AI 日报",
    heroGlow: " Web Archive",
  };
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
  const latestDate = latest?.date ?? "--";

  const reportTabConfig =
    activeTab === "daily"
      ? {
          tabLabel: "每日资讯",
          heroKicker: "Daily Information",
          heroTitle: "每日资讯",
          heroGlow: " Category Brief",
        }
      : activeReportChannel
        ? getReportTabConfig(activeReportChannel)
        : null;

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

  const editorialImage =
    "https://images.unsplash.com/photo-1534447677768-be436bb09401?q=80&w=2988&auto=format&fit=crop";

  const headlineByTab: Record<TabKey, { top: string; italic: string; bottom: string; upper: string; quote: string }> = {
    ai: {
      top: "Observe",
      italic: "the quiet",
      bottom: "signals in daily",
      upper: "AI Intelligence",
      quote: "深度信息不在噪声中，而在可持续追踪的线索里。",
    },
    crypto: {
      top: "Track",
      italic: "the subtle",
      bottom: "momentum behind",
      upper: "Crypto Markets",
      quote: "波动表象之下，结构性变化决定下一阶段叙事。",
    },
    daily: {
      top: "Read",
      italic: "the hidden",
      bottom: "links across",
      upper: "Daily Information",
      quote: "跨分类视角能更快识别宏观到行业的传导关系。",
    },
    github: {
      top: "Discover",
      italic: "the rising",
      bottom: "projects from",
      upper: "Github Trends",
      quote: "趋势仓库是技术方向变化最前沿的公开信号。",
    },
    hot: {
      top: "Find",
      italic: "the hottest",
      bottom: "videos across",
      upper: "YouTube Search",
      quote: "热度并非绝对流量，而是流量与时效性的乘积。",
    },
  };

  const headline = headlineByTab[activeTab];
  const now = new Date();
  const issueLabel = `VOL. ${String(
    activeTab === "github" ? trending?.items.length || 0 : reports.length || 0,
  ).padStart(3, "0")} — ${now
    .toLocaleDateString("en-US", { month: "short", year: "numeric" })
    .toUpperCase()}`;

  const verticalMetaItems =
    activeTab === "github"
      ? [
          `Trending ${(trending?.items.length || 0).toString().padStart(2, "0")}`,
          "Search1API Feed 02",
          "Bilingual Summary 03",
        ]
      : activeTab === "hot"
        ? ["YouTube Discovery 01", "Heat Ranking 02", "Realtime Query 03"]
        : [
            `${reportTabConfig?.tabLabel || "Archive"} ${(reports.length || 0).toString().padStart(2, "0")}`,
            `Latest ${latestDate === "--" ? "N/A" : latestDate} 02`,
            "Collections & Notes 03",
          ];

  return (
    <main className="chronos-home">
      <nav className="chronos-nav-bar" aria-label="首页分栏">
        <Link href="/?tab=ai" className={`chronos-nav-segment ${activeTab === "ai" ? "is-active" : ""}`}>
          AI日报
        </Link>
        <Link href="/?tab=crypto" className={`chronos-nav-segment ${activeTab === "crypto" ? "is-active" : ""}`}>
          币圈日报
        </Link>
        <Link href="/?tab=daily" className={`chronos-nav-segment ${activeTab === "daily" ? "is-active" : ""}`}>
          每日资讯
        </Link>
        <Link href="/?tab=github" className={`chronos-nav-segment ${activeTab === "github" ? "is-active" : ""}`}>
          Github趋势
        </Link>
        <Link href="/?tab=hot" className={`chronos-nav-segment ${activeTab === "hot" ? "is-active" : ""}`}>
          发现热点
        </Link>
      </nav>

      <div className="chronos-grid-container">
        <section className="chronos-main-content">
          <div className="chronos-date-badge">{issueLabel}</div>

          <div className="chronos-content-block">
            {activeTab === "hot" ? (
              <HotspotYoutubeSearch />
            ) : activeReportChannel && reportTabConfig ? (
              <>
                <section className="hero hero-no-side">
                  <div className="hero-main">
                    <p className="hero-kicker">{reportTabConfig.heroKicker}</p>
                    <h1>
                      {reportTabConfig.heroTitle}
                      <span className="hero-glow">{reportTabConfig.heroGlow}</span>
                    </h1>
                    <div className="hero-actions">
                      {latest ? (
                        <Link className="btn btn-primary" href={`/reports/${latest.slug}${reportLinkQuery}`}>
                          阅读最新一期
                        </Link>
                      ) : null}
                    </div>
                  </div>
                </section>

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

                <section className="grid-head">
                  <h2>{reportTabConfig.tabLabel}归档</h2>
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
            ) : (
              <>
                <section className="hero hero-no-side">
                  <div className="hero-main">
                    <p className="hero-kicker">Search1API · Github Trending</p>
                    <h1>
                      Github 趋势
                      <span className="hero-glow"> Daily Snapshot</span>
                    </h1>
                    <div className="hero-actions">
                      <Link className="btn btn-primary" href="/?tab=github">
                        刷新趋势
                      </Link>
                      <code className="cmd">Server-side Fetch</code>
                    </div>
                  </div>
                </section>

                <section className="grid-head">
                  <h2>热门仓库</h2>
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
            )}
          </div>
        </section>

        <aside className="chronos-sidebar">
          <div className="chronos-right-feature">
            <div className="chronos-hero-image-container">
              <img src={editorialImage} alt="Editorial visual" className="chronos-hero-image" />
            </div>

            <div className="chronos-headline-wrapper">
              <h1 className="chronos-headline">
                {headline.top} <span className="italic">{headline.italic}</span>
                <br />
                {headline.bottom}
                <br />
                <span className="upper">{headline.upper}</span>
              </h1>
            </div>

            <div className="chronos-article-excerpt">"{headline.quote}"</div>
          </div>

          <div className="chronos-vertical-meta">
            {verticalMetaItems.map((item, idx) => (
              <span key={`${item}-${idx}`} className="chronos-meta-item">
                {item}
              </span>
            ))}
          </div>
        </aside>
      </div>

      <div className="chronos-footer-bar">
        <Link href="/?tab=ai" className="chronos-footer-segment">
          Weekly Digest
        </Link>
        <Link href="/?tab=daily" className="chronos-footer-segment">
          Archives & Collections
        </Link>
      </div>
    </main>
  );
}
