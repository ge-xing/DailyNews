export type GithubTrendingItem = {
  id: string;
  rank: number;
  title: string;
  summaryEn: string;
  summaryZh: string;
  url: string;
  language: string;
  stars: string;
  forks: string;
};

export type GithubTrendingResult = {
  items: GithubTrendingItem[];
  fetchedAt: string;
  error: string;
  warning: string;
};

const DEFAULT_SEARCH1_BASE_URL = "https://api.302.ai";
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const REQUEST_TIMEOUT_MS = 30_000;

function pickFirstString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function pickFirstNumber(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function pickFirstCount(record: Record<string, unknown>, keys: string[]): string {
  const raw = pickFirstString(record, keys);
  if (raw) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return toHumanCount(parsed);
    return raw;
  }
  return toHumanCount(pickFirstNumber(record, keys));
}

function normalizeResults(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload.filter((item): item is Record<string, unknown> => !!item && typeof item === "object");
  }
  if (!payload || typeof payload !== "object") return [];

  const record = payload as Record<string, unknown>;
  const candidates = [record.results, record.items, record.data];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.filter((item): item is Record<string, unknown> => !!item && typeof item === "object");
    }
  }
  return [];
}

function getEnvFirst(names: string[]): string {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function buildAuthorization(apiKey: string): string {
  const value = apiKey.trim();
  if (!value) return "";
  if (value.toLowerCase().startsWith("bearer ")) return value;
  return `Bearer ${value}`;
}

async function fetchJsonWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const bodyText = await response.text();
    if (!response.ok) {
      const detail = bodyText.trim().slice(0, 500);
      throw new Error(`HTTP ${response.status}: ${detail || "请求失败"}`);
    }
    try {
      return JSON.parse(bodyText);
    } catch {
      throw new Error("返回结果不是合法 JSON");
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("请求超时（30秒）");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchTrendingFromSearch1(maxResults: number): Promise<unknown> {
  const apiKey = getEnvFirst(["SEARCH1_API_KEY", "TRENDING_API_KEY"]);
  if (!apiKey) {
    throw new Error("缺少 Search1 API Key，请配置 SEARCH1_API_KEY。");
  }

  const baseUrl = (process.env.SEARCH1_API_BASE_URL || DEFAULT_SEARCH1_BASE_URL).trim();
  const url = `${baseUrl.replace(/\/+$/, "")}/search1api/trending`;
  const payload = {
    search_service: "github",
    max_results: Math.max(1, Math.min(50, maxResults)),
  };

  return fetchJsonWithTimeout(
    url,
    {
      method: "POST",
      headers: {
        Authorization: buildAuthorization(apiKey),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    },
    REQUEST_TIMEOUT_MS,
  );
}

function extractGeminiText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const root = payload as Record<string, unknown>;
  const candidates = root.candidates;
  if (!Array.isArray(candidates)) return "";

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    const content = (candidate as Record<string, unknown>).content;
    if (!content || typeof content !== "object") continue;
    const parts = (content as Record<string, unknown>).parts;
    if (!Array.isArray(parts)) continue;

    const texts: string[] = [];
    for (const part of parts) {
      if (!part || typeof part !== "object") continue;
      const text = (part as Record<string, unknown>).text;
      if (typeof text === "string" && text.trim()) {
        texts.push(text.trim());
      }
    }
    if (texts.length > 0) return texts.join("\n").trim();
  }
  return "";
}

function parseJsonArrayFromText(raw: string): string[] {
  let candidate = raw.trim();
  if (candidate.startsWith("```")) {
    const lines = candidate.split("\n").filter((line) => !line.trim().startsWith("```"));
    candidate = lines.join("\n").trim();
  }
  const parsed = JSON.parse(candidate);
  if (!Array.isArray(parsed)) {
    throw new Error("Gemini 返回不是 JSON 数组");
  }
  return parsed.map((item) => {
    if (typeof item === "string") return item.trim();
    if (item === null || item === undefined) return "";
    return String(item).trim();
  });
}

async function translateWithGemini(descriptions: string[]): Promise<string[]> {
  const apiKey = getEnvFirst(["GEMINI_API_KEY", "GOOGLE_API_KEY"]);
  if (!apiKey) {
    throw new Error("未配置 GEMINI_API_KEY，已跳过翻译。");
  }

  const model = (process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL).trim();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const prompt = [
    "请把下面 JSON 数组中的英文简介翻译为简体中文。",
    "输出必须是严格 JSON 数组，长度与输入一致。",
    "每个元素只包含对应翻译文本，不要添加说明。",
    "输入为空字符串时，输出也必须是空字符串。",
    "",
    `输入：${JSON.stringify(descriptions)}`,
  ].join("\n");

  const payload = await fetchJsonWithTimeout(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      }),
      cache: "no-store",
    },
    REQUEST_TIMEOUT_MS,
  );

  const text = extractGeminiText(payload);
  if (!text) {
    throw new Error("Gemini 返回内容为空");
  }

  const translated = parseJsonArrayFromText(text);
  if (translated.length !== descriptions.length) {
    throw new Error("Gemini 翻译结果数量不匹配");
  }
  return translated;
}

function toHumanCount(value: number | null): string {
  if (value === null) return "";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

function normalizeItems(payload: unknown): GithubTrendingItem[] {
  const rows = normalizeResults(payload);
  return rows.map((row, idx) => {
    const title =
      pickFirstString(row, ["title", "name", "repo_name", "repository", "full_name", "headline"]) ||
      `Trending Repo #${idx + 1}`;
    const url = pickFirstString(row, ["url", "link", "html_url", "repository_url"]);
    const summaryEn = pickFirstString(row, [
      "description_en",
      "summary_en",
      "snippet_en",
      "snippet",
      "summary",
      "description",
      "excerpt",
    ]);
    const summaryZh = pickFirstString(row, [
      "description_zh",
      "summary_zh",
      "snippet_zh",
      "translation",
      "translation_zh",
      "zh",
    ]);
    const language = pickFirstString(row, ["language", "lang"]);

    const stars = pickFirstCount(row, ["stars", "stargazers_count", "star_count"]);
    const forks = pickFirstCount(row, ["forks", "forks_count"]);

    return {
      id: `${title}-${idx}`.toLowerCase().replace(/\s+/g, "-"),
      rank: idx + 1,
      title,
      summaryEn,
      summaryZh,
      url,
      language,
      stars,
      forks,
    };
  });
}

export async function getGithubTrending(maxResults = 20): Promise<GithubTrendingResult> {
  const fetchedAt = new Date().toISOString();

  try {
    const sourcePayload = await fetchTrendingFromSearch1(maxResults);
    const items = normalizeItems(sourcePayload).filter((item) => !!item.title);

    const pendingIndexes: number[] = [];
    const pendingTexts: string[] = [];
    items.forEach((item, idx) => {
      if (!item.summaryZh && item.summaryEn) {
        pendingIndexes.push(idx);
        pendingTexts.push(item.summaryEn);
      }
    });

    let warning = "";
    if (pendingTexts.length > 0) {
      try {
        const translated = await translateWithGemini(pendingTexts);
        translated.forEach((text, idx) => {
          const targetIndex = pendingIndexes[idx];
          if (targetIndex !== undefined) {
            items[targetIndex] = { ...items[targetIndex], summaryZh: text };
          }
        });
      } catch (error) {
        warning = error instanceof Error ? error.message : "Gemini 翻译失败，已展示英文原文。";
      }
    }

    return {
      items,
      fetchedAt,
      error: "",
      warning,
    };
  } catch (error) {
    return {
      items: [],
      fetchedAt,
      error: error instanceof Error ? error.message : "获取 Github 趋势失败",
      warning: "",
    };
  }
}
