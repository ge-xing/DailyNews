import Link from "next/link";
import { GenerateTodayButton } from "@/components/generate-today-button";
import { getAllReports } from "@/lib/reports";
import { getGithubTrending } from "@/lib/trending";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type HomeProps = {
  searchParams: Promise<{ tab?: string }>;
};

type TabKey = "ai" | "github";

function normalizeTab(tab?: string): TabKey {
  return tab === "github" ? "github" : "ai";
}

export default async function Home({ searchParams }: HomeProps) {
  const params = await searchParams;
  const activeTab = normalizeTab(params.tab);

  const reports = activeTab === "ai" ? await getAllReports() : [];
  const trending = activeTab === "github" ? await getGithubTrending(20) : null;

  const latest = reports[0];
  const latestDate = latest?.date ?? "--";
  const latestItems = latest?.itemCount ?? 0;
  const latestThemes = latest?.themeCount ?? 0;
  const fetchedAt = trending?.fetchedAt ? new Date(trending.fetchedAt).toLocaleString("zh-CN", { hour12: false }) : "";

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
            <Link href="/?tab=github" className={`side-tab ${activeTab === "github" ? "is-active" : ""}`}>
              Github趋势
            </Link>
          </nav>
          <p className="sidebar-tip">通过左侧切换日报归档与 Github 热门仓库。</p>
        </aside>

        <div className="main-panel">
          {activeTab === "ai" ? (
            <>
              <section className="hero">
                <div className="hero-main">
                  <p className="hero-kicker">Karpathy Curated RSS</p>
                  <h1>
                    AI 日报
                    <span className="hero-glow"> Web Archive</span>
                  </h1>
                  <p className="hero-copy">
                    站点优先从 OSS 读取每日 Markdown 报告，自动按日期归档；详情页支持长文阅读与快速跳转。
                  </p>
                  <div className="hero-actions">
                    {latest ? (
                      <Link className="btn btn-primary" href={`/reports/${latest.slug}`}>
                        阅读最新一期
                      </Link>
                    ) : null}
                    <GenerateTodayButton />
                    <code className="cmd">bash skill_m2h.sh</code>
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

              <section className="grid-head">
                <h2>日报归档</h2>
                <p>{reports.length > 0 ? `共 ${reports.length} 期` : "暂无日报，请先运行脚本生成。"}</p>
              </section>

              {reports.length === 0 ? (
                <section className="empty-card">
                  <p>当前没有可展示的日报文件。</p>
                  <p>
                    运行 <code>bash skill_m2h.sh</code> 后，会生成日报并上传 OSS（同时保留本地 <code>outputs/</code>）。
                  </p>
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
                      <Link className="card-link" href={`/reports/${report.slug}`}>
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
                  <p className="hero-copy">
                    数据由 <code>apis_trending</code> 目录脚本抓取，按条目展示热门仓库，并使用 Gemini 自动翻译英文简介。
                  </p>
                  <div className="hero-actions">
                    <Link className="btn btn-primary" href="/?tab=github">
                      刷新趋势
                    </Link>
                    <code className="cmd">python3 scripts/fetch_github_trending.py</code>
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
                    <strong>apis_trending</strong>
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
                  <p>请确认已配置 `SEARCH1_API_KEY`（或本地 `trending_api.txt`），然后刷新本页。</p>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </main>
  );
}
