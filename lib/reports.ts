import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const OUTPUTS_DIRS = [path.join(process.cwd(), "outputs"), path.join(tmpdir(), "daily-news", "outputs")];
const ENV_PY = path.join(process.cwd(), "env.py");
const REPORT_MARKER = "Karpathy 精选 RSS 日报";
const WECHAT_MARKER = "公众号格式";

export type ReportMeta = {
  slug: string;
  title: string;
  date: string;
  fileName: string;
  excerpt: string;
  itemCount: number;
  themeCount: number;
  updatedAt: string;
};

export type ReportDetail = ReportMeta & {
  content: string;
};

type ReportMetaInternal = ReportMeta & {
  source: "oss" | "local";
  contentUrl?: string;
};

type EnvPyVars = Record<string, string>;

type OssRuntimeConfig = {
  prefix: string;
  indexUrl: string;
  publicBaseUrl: string;
  bucketBaseUrl: string;
};

function safeDateFromName(fileName: string): string {
  const match = fileName.match(/^(\d{4}-\d{2}-\d{2})\s*-/);
  return match?.[1] ?? "未知日期";
}

function toSlug(fileName: string): string {
  return Buffer.from(fileName, "utf8").toString("base64url");
}

function fromSlug(slug: string): string | null {
  try {
    return Buffer.from(slug, "base64url").toString("utf8");
  } catch {
    return null;
  }
}

function isValidAbsoluteHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function encodeObjectKey(objectKey: string): string {
  return objectKey
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function joinUrl(base: string, suffix: string): string {
  const left = base.replace(/\/+$/, "");
  const right = suffix.replace(/^\/+/, "");
  return `${left}/${encodeObjectKey(right)}`;
}

function withNoCacheParam(url: string): string {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}_=${Date.now()}`;
}

function normalizeEndpoint(endpoint: string): string {
  return endpoint.replace(/^https?:\/\//, "").replace(/\/+$/, "").trim();
}

function parseEnvPyVars(text: string): EnvPyVars {
  const vars: EnvPyVars = {};
  const regex = /^\s*([a-zA-Z_]\w*)\s*=\s*['"]([^'"]*)['"]\s*$/gm;
  let match: RegExpExecArray | null = regex.exec(text);
  while (match) {
    vars[match[1]] = match[2];
    match = regex.exec(text);
  }
  return vars;
}

async function loadEnvPyVars(): Promise<EnvPyVars> {
  try {
    const raw = await fs.readFile(ENV_PY, "utf8");
    return parseEnvPyVars(raw);
  } catch {
    return {};
  }
}

function isReportFile(fileName: string): boolean {
  if (!fileName.endsWith(".md")) return false;
  if (!fileName.includes(REPORT_MARKER)) return false;
  if (fileName.includes(WECHAT_MARKER)) return false;
  if (fileName.includes("素材")) return false;
  return true;
}

function extractItemCount(text: string): number {
  const match = text.match(/\*\*(\d+)\*\*\s*条 RSS 更新/i) ?? text.match(/(\d+)\s*条 RSS 更新/i);
  return match ? Number.parseInt(match[1], 10) : 0;
}

function extractThemeCount(text: string): number {
  const match = text.match(/\*\*(\d+)\*\*\s*个核心主题/i) ?? text.match(/(\d+)\s*个核心主题/i);
  return match ? Number.parseInt(match[1], 10) : 0;
}

function buildExcerpt(text: string): string {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("[^"))
    .filter((line) => !line.startsWith("---"))
    .filter((line) => !line.startsWith("#"))
    .filter((line) => !line.startsWith(">"));

  if (lines.length === 0) return "暂无摘要。";

  return lines
    .slice(0, 2)
    .join(" ")
    .replace(/[*_`]/g, "")
    .slice(0, 160);
}

function compareByDateDesc(a: { fileName: string }, b: { fileName: string }): number {
  const da = safeDateFromName(a.fileName);
  const db = safeDateFromName(b.fileName);
  if (da !== db) return db.localeCompare(da);
  return b.fileName.localeCompare(a.fileName);
}

async function buildLocalMeta(fileName: string, fullPath: string): Promise<ReportMetaInternal> {
  const [content, stat] = await Promise.all([fs.readFile(fullPath, "utf8"), fs.stat(fullPath)]);
  const title = content.split("\n")[0]?.trim() || fileName.replace(/\.md$/, "");

  return {
    slug: toSlug(fileName),
    title,
    date: safeDateFromName(fileName),
    fileName,
    excerpt: buildExcerpt(content),
    itemCount: extractItemCount(content),
    themeCount: extractThemeCount(content),
    updatedAt: stat.mtime.toISOString(),
    source: "local",
  };
}

async function getAllLocalReportsInternal(): Promise<ReportMetaInternal[]> {
  const filePathMap = new Map<string, string>();

  for (const dir of OUTPUTS_DIRS) {
    try {
      const dirEntries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of dirEntries) {
        if (!entry.isFile()) continue;
        const fileName = entry.name;
        if (!filePathMap.has(fileName)) {
          filePathMap.set(fileName, path.join(dir, fileName));
        }
      }
    } catch {
      // ignore missing directories
    }
  }

  const reportFiles = Array.from(filePathMap.keys())
    .filter(isReportFile)
    .sort((a, b) => compareByDateDesc({ fileName: a }, { fileName: b }));
  const metas = await Promise.all(
    reportFiles.map((name) => buildLocalMeta(name, filePathMap.get(name) || path.join(OUTPUTS_DIRS[0], name))),
  );
  return metas;
}

async function getOssRuntimeConfig(): Promise<OssRuntimeConfig | null> {
  const envPy = await loadEnvPyVars();
  const prefix =
    process.env.ALIYUN_OSS_PREFIX ||
    process.env.OSS_PREFIX ||
    envPy.prefix ||
    "daily-news/reports";

  const publicBaseUrl =
    process.env.ALIYUN_OSS_PUBLIC_BASE_URL ||
    process.env.OSS_PUBLIC_BASE_URL ||
    envPy.public_base_url ||
    "";

  const bucket = process.env.ALIYUN_OSS_BUCKET_NAME || process.env.OSS_BUCKET_NAME || envPy.bucket_name || "";
  const endpointRaw = process.env.ALIYUN_OSS_ENDPOINT || process.env.OSS_ENDPOINT || envPy.endpoint || "";
  const endpoint = normalizeEndpoint(endpointRaw);
  const bucketBaseUrl = bucket && endpoint ? `https://${bucket}.${endpoint}` : "";

  const indexObject = `${prefix.replace(/^\/+|\/+$/g, "")}/index.json`;
  const indexUrlFromEnv = process.env.ALIYUN_OSS_INDEX_URL || process.env.OSS_INDEX_URL || "";
  const indexUrl = indexUrlFromEnv
    ? indexUrlFromEnv
    : publicBaseUrl
      ? joinUrl(publicBaseUrl, indexObject)
      : bucketBaseUrl
        ? joinUrl(bucketBaseUrl, indexObject)
        : "";

  if (!indexUrl || !isValidAbsoluteHttpUrl(indexUrl)) return null;

  return {
    prefix,
    indexUrl,
    publicBaseUrl,
    bucketBaseUrl,
  };
}

function toNumberSafe(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function resolveContentUrl(
  item: Record<string, unknown>,
  config: OssRuntimeConfig,
  fileName: string,
): string | undefined {
  const rawUrl = typeof item.url === "string" ? item.url.trim() : "";
  if (rawUrl && isValidAbsoluteHttpUrl(rawUrl)) return rawUrl;

  const objectName = typeof item.objectName === "string" ? item.objectName.trim() : "";
  if (objectName) {
    if (config.publicBaseUrl) return joinUrl(config.publicBaseUrl, objectName);
    if (config.bucketBaseUrl) return joinUrl(config.bucketBaseUrl, objectName);
  }

  const fallbackObject = `${config.prefix.replace(/^\/+|\/+$/g, "")}/${fileName}`;
  if (config.publicBaseUrl) return joinUrl(config.publicBaseUrl, fallbackObject);
  if (config.bucketBaseUrl) return joinUrl(config.bucketBaseUrl, fallbackObject);
  return undefined;
}

async function getAllOssReportsInternal(configInput?: OssRuntimeConfig | null): Promise<ReportMetaInternal[]> {
  const config = configInput ?? (await getOssRuntimeConfig());
  if (!config) return [];

  try {
    const resp = await fetch(withNoCacheParam(config.indexUrl), { cache: "no-store" });
    if (!resp.ok) return [];
    const payload = (await resp.json()) as { items?: unknown };
    const rawItems = Array.isArray(payload?.items) ? payload.items : [];

    const items: ReportMetaInternal[] = [];
    for (const raw of rawItems) {
      if (!raw || typeof raw !== "object") continue;
      const entry = raw as Record<string, unknown>;
      const fileNameRaw =
        (typeof entry.fileName === "string" && entry.fileName.trim()) ||
        (typeof entry.objectName === "string" ? path.basename(entry.objectName.trim()) : "");
      const fileName = path.basename(fileNameRaw);
      if (!fileName || !isReportFile(fileName)) continue;

      const titleRaw = typeof entry.title === "string" ? entry.title.trim() : "";
      const excerptRaw = typeof entry.excerpt === "string" ? entry.excerpt.trim() : "";
      const updatedAtRaw = typeof entry.updatedAt === "string" ? entry.updatedAt.trim() : "";
      const dateRaw = typeof entry.date === "string" ? entry.date.trim() : "";
      const contentUrl = resolveContentUrl(entry, config, fileName);

      items.push({
        slug: toSlug(fileName),
        title: titleRaw || fileName.replace(/\.md$/, ""),
        date: dateRaw || safeDateFromName(fileName),
        fileName,
        excerpt: excerptRaw || "暂无摘要。",
        itemCount: toNumberSafe(entry.itemCount),
        themeCount: toNumberSafe(entry.themeCount),
        updatedAt: updatedAtRaw || "",
        source: "oss",
        contentUrl,
      });
    }

    items.sort(compareByDateDesc);
    return items;
  } catch {
    return [];
  }
}

function toPublicMeta(item: ReportMetaInternal): ReportMeta {
  return {
    slug: item.slug,
    title: item.title,
    date: item.date,
    fileName: item.fileName,
    excerpt: item.excerpt,
    itemCount: item.itemCount,
    themeCount: item.themeCount,
    updatedAt: item.updatedAt,
  };
}

async function findReportFromSources(fileName: string): Promise<ReportMetaInternal | null> {
  const oss = await getAllOssReportsInternal();
  const inOss = oss.find((it) => it.fileName === fileName);
  if (inOss) return inOss;

  const local = await getAllLocalReportsInternal();
  const inLocal = local.find((it) => it.fileName === fileName);
  return inLocal ?? null;
}

export async function getAllReports(): Promise<ReportMeta[]> {
  const ossConfig = await getOssRuntimeConfig();
  if (ossConfig) {
    const oss = await getAllOssReportsInternal(ossConfig);
    return oss.map(toPublicMeta);
  }

  const local = await getAllLocalReportsInternal();
  return local.map(toPublicMeta);
}

export async function getReportBySlug(slug: string): Promise<ReportDetail | null> {
  const fileName = fromSlug(slug);
  if (!fileName || path.basename(fileName) !== fileName || !isReportFile(fileName)) return null;

  const ossConfig = await getOssRuntimeConfig();
  if (ossConfig) {
    const oss = await getAllOssReportsInternal(ossConfig);
    const meta = oss.find((it) => it.fileName === fileName);
    if (!meta) return null;

    if (meta.contentUrl && isValidAbsoluteHttpUrl(meta.contentUrl)) {
      try {
        const resp = await fetch(withNoCacheParam(meta.contentUrl), { cache: "no-store" });
        if (resp.ok) {
          const content = await resp.text();
          return {
            ...toPublicMeta(meta),
            content,
          };
        }
      } catch {
        return null;
      }
    }
    return null;
  }

  const meta = await findReportFromSources(fileName);
  if (!meta) return null;

  if (meta.source === "oss") return null;

  try {
    let content = "";
    for (const dir of OUTPUTS_DIRS) {
      try {
        content = await fs.readFile(path.join(dir, fileName), "utf8");
        break;
      } catch {
        // try next directory
      }
    }
    if (!content) return null;
    return {
      ...toPublicMeta(meta),
      content,
    };
  } catch {
    return null;
  }
}
