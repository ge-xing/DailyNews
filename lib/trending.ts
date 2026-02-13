import { spawn } from "node:child_process";
import path from "node:path";

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

function parsePayload(raw: string): unknown {
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    try {
      return JSON.parse(line);
    } catch {
      // Continue trying older lines.
    }
  }
  return null;
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

function runFetcher(maxResults: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const cwd = process.cwd();
    const scriptPath = path.join(cwd, "scripts", "fetch_github_trending.py");
    const child = spawn(
      "python3",
      [
        scriptPath,
        "--max-results",
        String(Math.max(1, Math.min(50, maxResults))),
      ],
      {
        cwd,
        env: process.env,
      },
    );

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Github 趋势请求超时（30秒）"));
    }, 30_000);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        const message = stderr.trim().split("\n").slice(-2).join(" | ") || `python exited with ${code}`;
        reject(new Error(message));
        return;
      }
      resolve(stdout);
    });
  });
}

export async function getGithubTrending(maxResults = 20): Promise<GithubTrendingResult> {
  const fetchedAt = new Date().toISOString();

  try {
    const stdout = await runFetcher(maxResults);
    const parsed = parsePayload(stdout);
    const root = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    const warning = root && typeof root.translation_error === "string" ? root.translation_error.trim() : "";
    const normalizedSource = root && Array.isArray(root.items) ? root.items : parsed;
    const items = normalizeItems(normalizedSource).filter((item) => !!item.title);
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
