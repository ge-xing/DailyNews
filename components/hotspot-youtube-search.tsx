"use client";

import { FormEvent, useMemo, useState } from "react";

type VideoItem = {
  rank: number;
  video_id: string;
  video_url: string;
  title: string;
  views: number;
  views_text: string;
  publication_time: string;
  publication_time_raw: string;
  thumbnails: string[];
  hot_degree: number;
};

type SearchResult = {
  query: string;
  requested_count: number;
  returned_count: number;
  order_by: string;
  language_code: string;
  country_code: string;
  fetched_pages: number;
  stop_reason: string;
  generated_at: string;
  videos: VideoItem[];
};

type SearchResponse =
  | {
      ok: true;
      data: SearchResult;
    }
  | {
      ok: false;
      message: string;
    };

const DEFAULT_VIDEO_COUNT = 30;

function formatViews(views: number): string {
  return new Intl.NumberFormat("zh-CN").format(Math.max(0, views || 0));
}

function formatTime(raw: string): string {
  if (!raw) return "--";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleString("zh-CN", { hour12: false });
}

export function HotspotYoutubeSearch() {
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<SearchResult | null>(null);

  const resultCountText = useMemo(() => {
    if (!result) return "";
    return `返回 ${result.returned_count} 条（请求 ${result.requested_count} 条）`;
  }, [result]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = keyword.trim();
    if (!text || loading) return;

    setLoading(true);
    setError("");
    try {
      const resp = await fetch("/api/hotspots/youtube/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          keyword: text,
          videoCount: DEFAULT_VIDEO_COUNT,
        }),
      });

      const payload = (await resp.json()) as SearchResponse;
      if (!resp.ok || !payload.ok) {
        const message = payload.ok ? "请求失败" : payload.message || "请求失败";
        throw new Error(message);
      }
      setResult(payload.data);
    } catch (err) {
      const message = err instanceof Error ? err.message : "搜索失败";
      setError(message);
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <section className="hero hero-no-side">
        <div className="hero-main">
          <p className="hero-kicker">Discover Hot Topics · Youtube</p>
          <h1>
            发现热点
            <span className="hero-glow"> Youtube</span>
          </h1>
          <div className="hot-subtabs" aria-label="发现热点子栏目">
            <span className="category-pill is-active">Youtube</span>
          </div>
          <form className="hot-search-form" onSubmit={onSubmit}>
            <input
              className="hot-search-input"
              type="search"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="输入关键词，例如：AI news"
              aria-label="Youtube 热点关键词"
            />
            <button type="submit" className="btn btn-primary" disabled={loading || !keyword.trim()}>
              {loading ? "搜索中..." : "搜索"}
            </button>
          </form>
          {error ? <p className="hot-status hot-error">{error}</p> : null}
        </div>
      </section>

      {result ? (
        <>
          <section className="grid-head">
            <h2>Youtube 热门视频</h2>
            <p>{resultCountText}</p>
          </section>
          <section className="hot-video-grid">
            {result.videos.map((video) => (
              <article key={`${video.video_id}-${video.rank}`} className="hot-video-card">
                {video.thumbnails?.[0] ? (
                  <a href={video.video_url} target="_blank" rel="noreferrer" className="hot-video-thumb-link">
                    <img className="hot-video-thumb" src={video.thumbnails[0]} alt={video.title || "thumbnail"} />
                  </a>
                ) : null}
                <div className="hot-video-content">
                  <p className="trend-rank">#{video.rank}</p>
                  <h3 className="trend-title">
                    <a href={video.video_url} target="_blank" rel="noreferrer">
                      {video.title || video.video_id}
                    </a>
                  </h3>
                  <p className="hot-video-link">
                    <a href={video.video_url} target="_blank" rel="noreferrer">
                      {video.video_url}
                    </a>
                  </p>
                  <div className="report-meta">
                    <span>热度 {video.hot_degree}</span>
                    <span>播放 {formatViews(video.views)}</span>
                    <span>发布时间 {formatTime(video.publication_time || video.publication_time_raw)}</span>
                  </div>
                </div>
              </article>
            ))}
          </section>
        </>
      ) : (
        <section className="empty-card">
          <p>输入关键词后即可查看 Youtube 热点结果。</p>
          <p>结果包含视频链接、播放量、发布时间、缩略图和热度评分。</p>
        </section>
      )}
    </>
  );
}
