import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const API_ENDPOINT = "https://api.tikhub.io/api/v1/youtube/web/search_video";
const ORDER_BY_VALUES = new Set(["this_week", "this_month", "this_year", "last_hour", "today"]);

const TOKEN_KEYS = ["TIKHUB_API_KEY", "TIKHUB_API_TOKEN", "YOUTUBE_WEB_API_TOKEN"] as const;
const NEXT_TOKEN_KEYS = [
  "continuation_token",
  "continuationToken",
  "next_continuation_token",
  "nextContinuationToken",
  "next_token",
  "nextToken",
] as const;

const TITLE_KEYS = ["title", "video_title", "name", "headline"] as const;
const URL_KEYS = ["url", "video_url", "watch_url", "link", "video_link", "webpage_url"] as const;
const ID_KEYS = ["video_id", "videoid", "videoId", "id"] as const;
const VIEW_KEYS = [
  "views",
  "view_count",
  "viewCount",
  "view_count_text",
  "viewCountText",
  "shortViewCountText",
  "short_view_count_text",
  "videoViewCountText",
  "video_view_count_text",
  "video_views",
  "views_text",
  "view_text",
  "short_view_count",
  "viewCountShort",
  "viewCountSimpleText",
  "view_count_simple_text",
] as const;
const PUBLISH_KEYS = [
  "published",
  "published_at",
  "published_time",
  "publish_time",
  "published_date",
  "publish_date",
  "upload_date",
  "uploaded_at",
  "time_text",
] as const;
const THUMBNAIL_KEYS = ["thumbnail", "thumbnails", "thumbnail_url", "cover", "covers", "image", "images"] as const;
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

type SearchBody = {
  keyword?: string;
  videoCount?: number;
  orderBy?: string;
  languageCode?: string;
  countryCode?: string;
  continuationToken?: string;
  maxPages?: number;
};

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

function toText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (Array.isArray(value)) return value.map((x) => toText(x)).filter(Boolean).join(" ").trim();
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const k of ["text", "simpleText", "label", "title", "name"]) {
      const s = toText(obj[k]);
      if (s) return s;
    }
    const runs = obj.runs;
    if (Array.isArray(runs)) {
      const s = runs
        .map((r) => (r && typeof r === "object" ? toText((r as Record<string, unknown>).text) : ""))
        .join("")
        .trim();
      if (s) return s;
    }
  }
  return "";
}

function* iterObjects(node: unknown): Generator<Record<string, unknown>> {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const it of node) yield* iterObjects(it);
    return;
  }
  if (typeof node === "object") {
    const obj = node as Record<string, unknown>;
    yield obj;
    for (const v of Object.values(obj)) yield* iterObjects(v);
  }
}

function* iterStrings(node: unknown): Generator<string> {
  if (typeof node === "string") {
    const s = node.trim();
    if (s) yield s;
    return;
  }
  if (Array.isArray(node)) {
    for (const it of node) yield* iterStrings(it);
    return;
  }
  if (node && typeof node === "object") {
    for (const v of Object.values(node as Record<string, unknown>)) yield* iterStrings(v);
  }
}

function* deepFindByKeys(node: unknown, keys: ReadonlyArray<string>): Generator<unknown> {
  const keySet = new Set(keys);
  for (const obj of iterObjects(node)) {
    for (const [k, v] of Object.entries(obj)) {
      if (keySet.has(k)) yield v;
    }
  }
}

function parseVideoIdFromUrl(raw: string): string {
  if (!raw) return "";
  try {
    const url = raw.startsWith("http") ? new URL(raw) : new URL(`https://www.youtube.com${raw}`);
    if (url.pathname === "/watch") {
      const v = url.searchParams.get("v") || "";
      return VIDEO_ID_RE.test(v) ? v : "";
    }
    if (url.pathname.startsWith("/shorts/")) {
      const id = url.pathname.split("/").pop() || "";
      return VIDEO_ID_RE.test(id) ? id : "";
    }
  } catch {
    return "";
  }
  return "";
}

function normalizeUrl(raw: string): string {
  const text = raw.trim();
  if (!text) return "";
  if (text.startsWith("//")) return `https:${text}`;
  if (text.startsWith("/watch") || text.startsWith("/shorts")) return `https://www.youtube.com${text}`;
  return text;
}

function parseViews(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.floor(value));
  const text = toText(value).toLowerCase();
  if (!text) return 0;
  if (text.includes("no views")) return 0;

  const patterns = [
    /(\d+(?:[.,]\d+)?)\s*([kmb]|万|萬|亿|億)?\s*(?:views?|view|次观看|次播放|观看|觀看|播放)/i,
    /(?:views?|view|次观看|次播放|观看|觀看|播放)\s*(\d+(?:[.,]\d+)?)\s*([kmb]|万|萬|亿|億)?/i,
    /(\d+(?:[.,]\d+)?)\s*([kmb]|万|萬|亿|億)?/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (!m) continue;
    const num = Number.parseFloat((m[1] || "0").replace(/,/g, ""));
    const u = (m[2] || "").toLowerCase();
    const f =
      u === "k"
        ? 1_000
        : u === "m"
          ? 1_000_000
          : u === "b"
            ? 1_000_000_000
            : u === "万" || u === "萬"
              ? 10_000
              : u === "亿" || u === "億"
                ? 100_000_000
                : 1;
    if (Number.isFinite(num) && num >= 0) return Math.floor(num * f);
  }
  return 0;
}

function parseDatetime(value: unknown, now: Date): Date | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    const ms = value > 1_000_000_000_000 ? value : value * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const raw = toText(value);
  if (!raw) return null;
  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) {
      const ms = n > 1_000_000_000_000 ? n : n * 1000;
      const d = new Date(ms);
      return Number.isNaN(d.getTime()) ? null : d;
    }
  }

  const lower = raw.toLowerCase();
  if (lower === "today" || raw === "今天") return now;
  if (lower === "yesterday" || raw === "昨天") return new Date(now.getTime() - 24 * 3600_000);

  const en = lower.match(/(\d+)\s*(second|minute|hour|day|week|month|year)s?\s*ago/i);
  if (en) {
    const n = Number(en[1]);
    const unit = en[2];
    const hours =
      unit === "second"
        ? n / 3600
        : unit === "minute"
          ? n / 60
          : unit === "hour"
            ? n
            : unit === "day"
              ? n * 24
              : unit === "week"
                ? n * 24 * 7
                : unit === "month"
                  ? n * 24 * 30
                  : n * 24 * 365;
    return new Date(now.getTime() - hours * 3600_000);
  }

  const zh = raw.match(/(\d+)\s*(秒|分钟|分|小时|天|周|个月|月|年)\s*前/);
  if (zh) {
    const n = Number(zh[1]);
    const u = zh[2];
    const hours =
      u === "秒"
        ? n / 3600
        : u === "分钟" || u === "分"
          ? n / 60
          : u === "小时"
            ? n
            : u === "天"
              ? n * 24
              : u === "周"
                ? n * 24 * 7
                : u === "个月" || u === "月"
                  ? n * 24 * 30
                  : n * 24 * 365;
    return new Date(now.getTime() - hours * 3600_000);
  }

  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function extractThumbnails(item: Record<string, unknown>): string[] {
  const urls: string[] = [];
  const add = (v: unknown): void => {
    if (typeof v === "string") {
      const s = v.trim();
      if (s.startsWith("http://") || s.startsWith("https://")) urls.push(s);
      return;
    }
    if (Array.isArray(v)) {
      for (const it of v) add(it);
      return;
    }
    if (v && typeof v === "object") {
      for (const x of Object.values(v as Record<string, unknown>)) add(x);
    }
  };
  for (const v of deepFindByKeys(item, THUMBNAIL_KEYS)) add(v);
  return [...new Set(urls)];
}

function firstTextByKeys(item: Record<string, unknown>, keys: ReadonlyArray<string>): string {
  for (const v of deepFindByKeys(item, keys)) {
    const s = toText(v);
    if (s) return s;
  }
  return "";
}

function extractViews(item: Record<string, unknown>): { views: number; raw: string } {
  const candidates: string[] = [];
  for (const v of deepFindByKeys(item, VIEW_KEYS)) {
    const s = toText(v);
    if (s) candidates.push(s);
  }
  for (const obj of iterObjects(item)) {
    for (const [k, v] of Object.entries(obj)) {
      const key = k.toLowerCase();
      const s = toText(v);
      if (!s) continue;
      if (key.includes("view")) candidates.push(s);
      if ((key === "label" || key === "simpletext" || key === "text" || key === "title") && /view|观看|播放|觀看/i.test(s)) {
        candidates.push(s);
      }
    }
  }
  for (const s of iterStrings(item)) {
    if (/view|观看|播放|觀看/i.test(s)) candidates.push(s);
  }

  let best = 0;
  let bestRaw = "";
  for (const c of candidates) {
    const n = parseViews(c);
    if (n > best) {
      best = n;
      bestRaw = c;
    }
  }
  return { views: best, raw: bestRaw };
}

function extractVideoId(item: Record<string, unknown>): string {
  for (const key of ["videoId", "video_id", "videoid"] as const) {
    for (const obj of iterObjects(item)) {
      const s = toText(obj[key]);
      if (VIDEO_ID_RE.test(s)) return s;
    }
  }
  for (const v of deepFindByKeys(item, ID_KEYS)) {
    const s = toText(v);
    if (VIDEO_ID_RE.test(s)) return s;
  }
  for (const v of deepFindByKeys(item, URL_KEYS)) {
    const id = parseVideoIdFromUrl(normalizeUrl(toText(v)));
    if (id) return id;
  }
  for (const t of extractThumbnails(item)) {
    const m = t.match(/\/vi(?:_webp)?\/([A-Za-z0-9_-]{11})(?:\/|\?|$)/);
    if (m?.[1]) return m[1];
  }
  return "";
}

function hotDegree(views: number, published: Date | null, now: Date): number {
  const ageHours = published ? Math.max(0, (now.getTime() - published.getTime()) / 3600_000) : 24 * 365;
  const recencyWeight = 1 / (1 + ageHours / 24);
  return Math.round(Math.log10(Math.max(1, views) + 1) * recencyWeight * 100 * 10_000) / 10_000;
}

function looksLikeVideo(obj: Record<string, unknown>): boolean {
  const title = firstTextByKeys(obj, TITLE_KEYS);
  if (!title) return false;
  const ref = firstTextByKeys(obj, URL_KEYS) || firstTextByKeys(obj, ID_KEYS);
  const sig = firstTextByKeys(obj, VIEW_KEYS) || firstTextByKeys(obj, PUBLISH_KEYS);
  return Boolean(ref || sig);
}

function collectCandidates(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data.filter((x): x is Record<string, unknown> => !!x && typeof x === "object");
  if (!data || typeof data !== "object") return [];

  const obj = data as Record<string, unknown>;
  for (const key of ["videos", "items", "results", "contents", "data"]) {
    const rows = obj[key];
    if (Array.isArray(rows)) {
      const got = rows.filter((x): x is Record<string, unknown> => !!x && typeof x === "object");
      if (got.length) return got;
    }
  }

  const out: Record<string, unknown>[] = [];
  for (const node of iterObjects(data)) {
    if (looksLikeVideo(node)) out.push(node);
  }
  return out;
}

function decodeData(data: unknown): unknown {
  let v = data;
  for (let i = 0; i < 3; i += 1) {
    if (typeof v !== "string") break;
    const s = v.trim();
    if (!s) break;
    if ((s.startsWith("{") && s.endsWith("}")) || (s.startsWith("[") && s.endsWith("]"))) {
      try {
        v = JSON.parse(s) as unknown;
        continue;
      } catch {
        break;
      }
    }
  }
  return v;
}

function extractNextToken(payload: Record<string, unknown>, data: unknown): string {
  for (const k of NEXT_TOKEN_KEYS) {
    const v = payload[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  for (const node of [data, payload]) {
    for (const obj of iterObjects(node)) {
      for (const [k, v] of Object.entries(obj)) {
        if (k.toLowerCase().includes("continuation") && typeof v === "string" && v.trim()) return v.trim();
      }
    }
  }
  return "";
}

function extractTokenFromEnv(): string {
  for (const k of TOKEN_KEYS) {
    const v = process.env[k]?.trim();
    if (v) return v;
  }
  return "";
}

function clamp(value: number | undefined, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  const n = Math.floor(Number(value));
  return Math.max(min, Math.min(max, n));
}

export async function POST(request: Request) {
  let body: SearchBody = {};
  try {
    body = (await request.json()) as SearchBody;
  } catch {
    return NextResponse.json({ ok: false, message: "请求体必须是 JSON。" }, { status: 400 });
  }

  const keyword = (body.keyword || "").trim();
  if (!keyword) return NextResponse.json({ ok: false, message: "关键词不能为空。" }, { status: 400 });

  const token = extractTokenFromEnv();
  if (!token) {
    return NextResponse.json(
      {
        ok: false,
        message: "缺少 TIKHUB_API_KEY（或 TIKHUB_API_TOKEN/YOUTUBE_WEB_API_TOKEN）环境变量。",
      },
      { status: 500 },
    );
  }

  const videoCount = clamp(body.videoCount, 1, 100, 30);
  const maxPages = clamp(body.maxPages, 1, 40, 30);
  const orderBy = ORDER_BY_VALUES.has((body.orderBy || "").trim()) ? (body.orderBy || "").trim() : "this_month";
  const languageCode = (body.languageCode || "en").trim() || "en";
  const countryCode = (body.countryCode || "us").trim() || "us";
  const now = new Date();

  const videos: Array<Omit<VideoItem, "rank">> = [];
  const seenIds = new Set<string>();
  const seenUrls = new Set<string>();
  const seenTokens = new Set<string>();
  const usedContinuationTokens: string[] = [];
  let continuationToken = (body.continuationToken || "").trim();
  let fetchedPages = 0;
  let stopReason = "max_pages_reached";
  let lastContinuationToken = "";

  try {
    while (fetchedPages < maxPages && videos.length < videoCount) {
      fetchedPages += 1;
      const params = new URLSearchParams({
        search_query: keyword,
        language_code: languageCode,
        order_by: orderBy,
        country_code: countryCode,
      });
      if (continuationToken) params.set("continuation_token", continuationToken);

      const resp = await fetch(`${API_ENDPOINT}?${params.toString()}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      });
      if (!resp.ok) {
        throw new Error(`TikHub 请求失败: HTTP ${resp.status}`);
      }
      const payload = (await resp.json()) as Record<string, unknown>;
      if (typeof payload.code === "number" && payload.code !== 200) {
        throw new Error(String(payload.message || payload.message_zh || `TikHub 错误: code=${payload.code}`));
      }

      const parsedData = decodeData(payload.data);
      const candidates = collectCandidates(parsedData);
      for (const c of candidates) {
        const videoId = extractVideoId(c);
        const videoUrl = videoId ? `https://www.youtube.com/watch?v=${videoId}` : "";
        if (!videoId || !videoUrl) continue;
        if (seenIds.has(videoId) || seenUrls.has(videoUrl)) continue;

        const title = firstTextByKeys(c, TITLE_KEYS);
        const { views, raw: viewsRaw } = extractViews(c);
        const publicationRaw = firstTextByKeys(c, PUBLISH_KEYS);
        const publicationDate = parseDatetime(publicationRaw, now);
        const publicationIso = publicationDate ? publicationDate.toISOString() : "";
        const thumbnails = extractThumbnails(c);
        const hot = hotDegree(views, publicationDate, now);

        videos.push({
          video_id: videoId,
          video_url: videoUrl,
          title: title || videoId,
          views,
          views_text: viewsRaw,
          publication_time: publicationIso,
          publication_time_raw: publicationRaw,
          thumbnails,
          hot_degree: hot,
        });
        seenIds.add(videoId);
        seenUrls.add(videoUrl);
        if (videos.length >= videoCount) break;
      }

      const nextToken = extractNextToken(payload, parsedData);
      lastContinuationToken = nextToken;
      if (!nextToken) {
        stopReason = "no_continuation_token";
        break;
      }
      if (seenTokens.has(nextToken)) {
        stopReason = "duplicate_continuation_token";
        break;
      }
      seenTokens.add(nextToken);
      usedContinuationTokens.push(nextToken);
      continuationToken = nextToken;
    }

    if (videos.length >= videoCount) stopReason = "target_count_reached";

    const ranked = videos
      .sort((a, b) => (b.hot_degree !== a.hot_degree ? b.hot_degree - a.hot_degree : b.views - a.views))
      .slice(0, videoCount)
      .map((v, i) => ({ ...v, rank: i + 1 }));

    return NextResponse.json(
      {
        ok: true,
        data: {
          query: keyword,
          requested_count: videoCount,
          returned_count: ranked.length,
          order_by: orderBy,
          language_code: languageCode,
          country_code: countryCode,
          fetched_pages: fetchedPages,
          stop_reason: stopReason,
          last_continuation_token: lastContinuationToken,
          used_continuation_tokens: usedContinuationTokens,
          generated_at: new Date().toISOString(),
          videos: ranked,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : "YouTube 热点搜索失败。";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
