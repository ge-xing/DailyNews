import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const OUTPUTS_DIRS = [path.join(process.cwd(), "outputs"), path.join(tmpdir(), "daily-news", "outputs")];
const ENV_PY = path.join(process.cwd(), "env.py");
const WECHAT_MARKER = "公众号格式";
const MATERIAL_MARKER = "素材";

export type ReportChannel = "ai" | "crypto";

const DEFAULT_CHANNEL: ReportChannel = "ai";

type ChannelConfig = {
  reportMarker: string;
  defaultPrefix: string;
  prefixEnvKeys: readonly string[];
  indexUrlEnvKeys: readonly string[];
  envPyPrefixKeys: readonly string[];
};

const CHANNEL_CONFIG: Record<ReportChannel, ChannelConfig> = {
  ai: {
    reportMarker: "Karpathy 精选 RSS 日报",
    defaultPrefix: "daily-news/reports",
    prefixEnvKeys: ["ALIYUN_OSS_PREFIX", "OSS_PREFIX"],
    indexUrlEnvKeys: ["ALIYUN_OSS_INDEX_URL", "OSS_INDEX_URL"],
    envPyPrefixKeys: ["prefix"],
  },
  crypto: {
    reportMarker: "币圈每日资讯",
    defaultPrefix: "daily-news/crypto-reports",
    prefixEnvKeys: ["ALIYUN_OSS_CRYPTO_PREFIX", "OSS_CRYPTO_PREFIX"],
    indexUrlEnvKeys: ["ALIYUN_OSS_CRYPTO_INDEX_URL", "OSS_CRYPTO_INDEX_URL"],
    envPyPrefixKeys: ["crypto_prefix"],
  },
};

export type ReportMeta = {
  slug: string;
  channel: ReportChannel;
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
  channel: ReportChannel;
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

function getEnvFirst(keys: readonly string[]): string {
  for (const key of keys) {
    const value = process.env[key];
    if (value && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function getEnvPyFirst(envPyVars: EnvPyVars, keys: readonly string[]): string {
  for (const key of keys) {
    const value = envPyVars[key];
    if (value && value.trim()) {
      return value.trim();
    }
  }
  return "";
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

function isReportLikeMarkdown(fileName: string): boolean {
  if (!fileName.endsWith(".md")) return false;
  if (fileName.includes(WECHAT_MARKER)) return false;
  if (fileName.includes(MATERIAL_MARKER)) return false;
  return true;
}

function matchChannelFileName(fileName: string, channel: ReportChannel): boolean {
  return fileName.includes(CHANNEL_CONFIG[channel].reportMarker);
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

async function buildLocalMeta(fileName: string, fullPath: string, channel: ReportChannel): Promise<ReportMetaInternal> {
  const [content, stat] = await Promise.all([fs.readFile(fullPath, "utf8"), fs.stat(fullPath)]);
  const title = content.split("\n")[0]?.trim() || fileName.replace(/\.md$/, "");

  return {
    slug: toSlug(fileName),
    channel,
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

async function getAllLocalReportsInternal(channel: ReportChannel): Promise<ReportMetaInternal[]> {
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
    .filter((fileName) => isReportLikeMarkdown(fileName) && matchChannelFileName(fileName, channel))
    .sort((a, b) => compareByDateDesc({ fileName: a }, { fileName: b }));
  const metas = await Promise.all(
    reportFiles.map((name) => buildLocalMeta(name, filePathMap.get(name) || path.join(OUTPUTS_DIRS[0], name), channel)),
  );
  return metas;
}

async function getOssRuntimeConfig(channel: ReportChannel): Promise<OssRuntimeConfig | null> {
  const envPy = await loadEnvPyVars();
  const channelConfig = CHANNEL_CONFIG[channel];
  const prefix =
    getEnvFirst(channelConfig.prefixEnvKeys) ||
    getEnvPyFirst(envPy, channelConfig.envPyPrefixKeys) ||
    channelConfig.defaultPrefix;

  const publicBaseUrl =
    process.env.ALIYUN_OSS_PUBLIC_BASE_URL ||
    process.env.OSS_PUBLIC_BASE_URL ||
    envPy.public_base_url ||
    "";

  const bucket = process.env.ALIYUN_OSS_BUCKET_NAME || process.env.OSS_BUCKET_NAME || envPy.bucket_name || "";
  const endpointRaw = process.env.ALIYUN_OSS_ENDPOINT || process.env.OSS_ENDPOINT || envPy.endpoint || "";
  const endpoint = normalizeEndpoint(endpointRaw);
  const bucketBaseUrl = bucket && endpoint ? `https://${bucket}.${endpoint}` : "";

  const cleanPrefix = prefix.replace(/^\/+|\/+$/g, "");
  const indexObject = `${cleanPrefix}/index.json`;
  const indexUrlFromEnv = getEnvFirst(channelConfig.indexUrlEnvKeys);
  const indexUrl = indexUrlFromEnv
    ? indexUrlFromEnv
    : publicBaseUrl
      ? joinUrl(publicBaseUrl, indexObject)
      : bucketBaseUrl
        ? joinUrl(bucketBaseUrl, indexObject)
        : "";

  if (!indexUrl || !isValidAbsoluteHttpUrl(indexUrl)) return null;

  return {
    channel,
    prefix: cleanPrefix,
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

  const fallbackObject = `${config.prefix}/${fileName}`;
  if (config.publicBaseUrl) return joinUrl(config.publicBaseUrl, fallbackObject);
  if (config.bucketBaseUrl) return joinUrl(config.bucketBaseUrl, fallbackObject);
  return undefined;
}

async function getAllOssReportsInternal(
  channel: ReportChannel,
  configInput?: OssRuntimeConfig | null,
): Promise<ReportMetaInternal[]> {
  const config = configInput ?? (await getOssRuntimeConfig(channel));
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
      if (!fileName || !isReportLikeMarkdown(fileName)) continue;

      const titleRaw = typeof entry.title === "string" ? entry.title.trim() : "";
      const excerptRaw = typeof entry.excerpt === "string" ? entry.excerpt.trim() : "";
      const updatedAtRaw = typeof entry.updatedAt === "string" ? entry.updatedAt.trim() : "";
      const dateRaw = typeof entry.date === "string" ? entry.date.trim() : "";
      const contentUrl = resolveContentUrl(entry, config, fileName);

      items.push({
        slug: toSlug(fileName),
        channel,
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
    channel: item.channel,
    title: item.title,
    date: item.date,
    fileName: item.fileName,
    excerpt: item.excerpt,
    itemCount: item.itemCount,
    themeCount: item.themeCount,
    updatedAt: item.updatedAt,
  };
}

function getChannelSearchOrder(preferredChannel?: ReportChannel): ReportChannel[] {
  if (preferredChannel === "crypto") return ["crypto", "ai"];
  return ["ai", "crypto"];
}

async function findReportMetaInChannel(fileName: string, channel: ReportChannel): Promise<ReportMetaInternal | null> {
  const ossConfig = await getOssRuntimeConfig(channel);
  if (ossConfig) {
    const oss = await getAllOssReportsInternal(channel, ossConfig);
    const inOss = oss.find((it) => it.fileName === fileName);
    return inOss ?? null;
  }

  const local = await getAllLocalReportsInternal(channel);
  const inLocal = local.find((it) => it.fileName === fileName);
  return inLocal ?? null;
}

async function readLocalReportContent(fileName: string): Promise<string | null> {
  for (const dir of OUTPUTS_DIRS) {
    try {
      return await fs.readFile(path.join(dir, fileName), "utf8");
    } catch {
      // try next directory
    }
  }
  return null;
}

async function toReportDetail(meta: ReportMetaInternal): Promise<ReportDetail | null> {
  if (meta.source === "oss") {
    if (!meta.contentUrl || !isValidAbsoluteHttpUrl(meta.contentUrl)) return null;
    try {
      const resp = await fetch(withNoCacheParam(meta.contentUrl), { cache: "no-store" });
      if (!resp.ok) return null;
      const content = await resp.text();
      return {
        ...toPublicMeta(meta),
        content,
      };
    } catch {
      return null;
    }
  }

  const content = await readLocalReportContent(meta.fileName);
  if (!content) return null;
  return {
    ...toPublicMeta(meta),
    content,
  };
}

export async function getAllReports(channel: ReportChannel = DEFAULT_CHANNEL): Promise<ReportMeta[]> {
  const ossConfig = await getOssRuntimeConfig(channel);
  if (ossConfig) {
    const oss = await getAllOssReportsInternal(channel, ossConfig);
    return oss.map(toPublicMeta);
  }

  const local = await getAllLocalReportsInternal(channel);
  return local.map(toPublicMeta);
}

export async function getReportBySlug(
  slug: string,
  preferredChannel?: ReportChannel,
): Promise<ReportDetail | null> {
  const fileName = fromSlug(slug);
  if (!fileName || path.basename(fileName) !== fileName || !isReportLikeMarkdown(fileName)) return null;

  for (const channel of getChannelSearchOrder(preferredChannel)) {
    const meta = await findReportMetaInChannel(fileName, channel);
    if (!meta) continue;

    const detail = await toReportDetail(meta);
    if (detail) return detail;
  }

  return null;
}
