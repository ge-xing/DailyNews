import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ReportMarkdown } from "@/components/report-markdown";
import { getReportBySlug } from "@/lib/reports";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
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

export default async function ReportPage({ params }: PageProps) {
  const { slug } = await params;
  const report = await getReportBySlug(slug);

  if (!report) {
    notFound();
  }

  return (
    <main className="shell">
      <div className="ambient ambient-a" />
      <div className="ambient ambient-b" />
      <div className="container detail-layout">
        <div className="detail-top">
          <div className="detail-nav">
            <Link href="/" className="back-link">
              返回首页
            </Link>
            <p className="detail-date">{report.date}</p>
          </div>
          <h1>{report.title}</h1>
          <div className="detail-tags">
            <span>{report.itemCount > 0 ? `${report.itemCount} 条更新` : "日报正文"}</span>
            <span>{report.themeCount > 0 ? `${report.themeCount} 个主题` : "Karpathy RSS"}</span>
          </div>
        </div>
        <article className="detail-card">
          <ReportMarkdown markdown={report.content} />
        </article>
      </div>
    </main>
  );
}
