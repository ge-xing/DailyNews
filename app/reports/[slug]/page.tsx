import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ReportMarkdown } from "@/components/report-markdown";
import { getReportBySlug, type ReportChannel } from "@/lib/reports";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ tab?: string; category?: string }>;
};

function normalizeReportTab(tab?: string): ReportChannel | undefined {
  if (tab === "daily") return "finance";
  if (tab === "finance") return "finance";
  if (tab === "crypto") return "crypto";
  if (tab === "ai") return "ai";
  return undefined;
}

export async function generateMetadata({ params }: Pick<PageProps, "params">): Promise<Metadata> {
  const { slug } = await params;
  const report = await getReportBySlug(slug);

  if (!report) {
    return {
      title: "日报不存在",
    };
  }

  return {
    title: report.title,
    description: report.excerpt,
  };
}

export default async function ReportPage({ params, searchParams }: PageProps) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const preferredChannel = normalizeReportTab(query.tab);
  const report = await getReportBySlug(slug, preferredChannel);

  if (!report) {
    notFound();
  }

  const fromDailyTab = query.tab === "daily" || query.tab === "finance";
  const backHref =
    fromDailyTab
      ? query.category
        ? `/?tab=daily&category=${encodeURIComponent(query.category)}`
        : "/?tab=daily"
      : `/?tab=${preferredChannel ?? report.channel}`;
  const themeLabel =
    report.channel === "finance" ? "Financial RSS" : report.channel === "crypto" ? "Crypto RSS" : "Karpathy RSS";

  return (
    <main className="shell">
      <div className="ambient ambient-a" />
      <div className="ambient ambient-b" />
      <div className="container detail-layout">
        <div className="detail-top">
          <div className="detail-nav">
            <Link href={backHref} className="back-link">
              返回首页
            </Link>
            <p className="detail-date">{report.date}</p>
          </div>
          <h1>{report.title}</h1>
          <div className="detail-tags">
            <span>{report.itemCount > 0 ? `${report.itemCount} 条更新` : "日报正文"}</span>
            <span>{report.themeCount > 0 ? `${report.themeCount} 个主题` : themeLabel}</span>
          </div>
        </div>
        <article className="detail-card">
          <ReportMarkdown markdown={report.content} />
        </article>
      </div>
    </main>
  );
}
