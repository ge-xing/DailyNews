import Link from "next/link";

export default function NotFound() {
  return (
    <main className="shell">
      <div className="container">
        <section className="empty-card">
          <h1>未找到该日报</h1>
          <p>链接可能已经过期，或对应文件已删除。</p>
          <Link className="btn btn-primary" href="/">
            返回首页
          </Link>
        </section>
      </div>
    </main>
  );
}
