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
  heroCopy: string;
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
      heroCopy: "站点优先从 OSS 读取币圈每日 Markdown 报告，自动归档并支持详情页阅读。",
    };
  }

  return {
    tabLabel: "AI日报",
    heroKicker: "Karpathy Curated RSS",
    heroTitle: "AI 日报",
    heroGlow: " Web Archive",
    heroCopy: "站点优先从 OSS 读取每日 Markdown 报告，自动按日期归档；详情页支持长文阅读与快速跳转。",
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
  const latestItems = latest?.itemCount ?? 0;
  const latestThemes = latest?.themeCount ?? 0;
  const fetchedAt = trending?.fetchedAt ? new Date(trending.fetchedAt).toLocaleString("zh-CN", { hour12: false }) : "";

  const reportTabConfig =
    activeTab === "daily"
      ? {
          tabLabel: "每日资讯",
          heroKicker: "Daily Information",
          heroTitle: "每日资讯",
          heroGlow: " Category Brief",
          heroCopy: "按分类查看财经资讯日报；每类单独生成并归档，支持快速切换与阅读。",
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

  return (
    <main className="shell">
      <div className="ambient ambient-a" />
      <div className="ambient ambient-b" />
      <div className="container app-layout">
        <aside className="sidebar">
          <p className="sidebar-title">内容导航</p>
          <nav className="tab-list" aria-label="首页分栏">
            <Link href="/?tab=ai" className={`side-tab ${activeTab === "ai" ? "is-active" : ""}`}>
              AI日报
            </Link>
            <Link href="/?tab=crypto" className={`side-tab ${activeTab === "crypto" ? "is-active" : ""}`}>
              币圈日报
            </Link>
            <Link href="/?tab=daily" className={`side-tab ${activeTab === "daily" ? "is-active" : ""}`}>
              每日资讯
            </Link>
            <Link href="/?tab=github" className={`side-tab ${activeTab === "github" ? "is-active" : ""}`}>
              Github趋势
            </Link>
            <Link href="/?tab=hot" className={`side-tab ${activeTab === "hot" ? "is-active" : ""}`}>
              发现热点
            </Link>
          </nav>
          <p className="sidebar-tip">通过左侧切换 AI 日报、币圈日报、每日资讯、Github 趋势与发现热点。</p>
        </aside>

        <div className="main-panel">
          {activeTab === "hot" ? (
            <HotspotYoutubeSearch />
          ) : activeReportChannel && reportTabConfig ? (
            <>
              <section className="hero">
                <div className="hero-main">
                  <p className="hero-kicker">{reportTabConfig.heroKicker}</p>
                  <h1>
                    {reportTabConfig.heroTitle}
                    <span className="hero-glow">{reportTabConfig.heroGlow}</span>
                  </h1>
                  <p className="hero-copy">{reportTabConfig.heroCopy}</p>
                  <div className="hero-actions">
                    {latest ? (
                      <Link className="btn btn-primary" href={`/reports/${latest.slug}${reportLinkQuery}`}>
                        阅读最新一期
                      </Link>
                    ) : null}
                  </div>
                </div>

                <div className="hero-side">
                  <p className="side-title">今日快照</p>
                  <div className="hero-metric">
                    <span>最新日期</span>
                    <strong>{latestDate}</strong>
                  </div>
                  <div className="hero-metric">
                    <span>更新条数</span>
                    <strong>{latestItems > 0 ? `${latestItems} 条` : "--"}</strong>
                  </div>
                  <div className="hero-metric">
                    <span>核心主题</span>
                    <strong>{latestThemes > 0 ? `${latestThemes} 个` : "--"}</strong>
                  </div>
                  <div className="hero-metric">
                    <span>总期数</span>
                    <strong>{reports.length}</strong>
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
                    <article key={report.slug} className="report-card">
                      <p className="report-date">{report.date}</p>
                      <h3>{report.title}</h3>
                      <p className="report-excerpt">{report.excerpt}</p>
                      <div className="report-meta">
                        <span>{report.itemCount > 0 ? `${report.itemCount} 条更新` : "待统计"}</span>
                        <span>{report.themeCount > 0 ? `${report.themeCount} 个主题` : "待统计"}</span>
                      </div>
                      <Link className="card-link" href={`/reports/${report.slug}${reportLinkQuery}`}>
                        打开全文
                      </Link>
                    </article>
                  ))}
                </section>
              )}
            </>
          ) : (
            <>
              <section className="hero">
                <div className="hero-main">
                  <p className="hero-kicker">Search1API · Github Trending</p>
                  <h1>
                    Github 趋势
                    <span className="hero-glow"> Daily Snapshot</span>
                  </h1>
                  <p className="hero-copy">数据由服务端实时抓取并按条目展示热门仓库，同时使用 Gemini 自动翻译英文简介。</p>
                  <div className="hero-actions">
                    <Link className="btn btn-primary" href="/?tab=github">
                      刷新趋势
                    </Link>
                    <code className="cmd">Server-side Fetch</code>
                  </div>
                </div>

                <div className="hero-side">
                  <p className="side-title">抓取状态</p>
                  <div className="hero-metric">
                    <span>抓取时间</span>
                    <strong>{fetchedAt || "--"}</strong>
                  </div>
                  <div className="hero-metric">
                    <span>返回条数</span>
                    <strong>{trending?.items.length ?? 0}</strong>
                  </div>
                  <div className="hero-metric">
                    <span>数据源</span>
                    <strong>Search1API</strong>
                  </div>
                  <div className="hero-metric">
                    <span>翻译状态</span>
                    <strong>{trending?.warning ? "部分失败" : "正常"}</strong>
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
      </div>
    </main>
  );
}
