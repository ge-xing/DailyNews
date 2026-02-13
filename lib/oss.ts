import { createHmac } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

type EnvPyVars = Record<string, string>;

export type OssConfig = {
  accessKeyId: string;
  accessKeySecret: string;
  bucketName: string;
  endpoint: string;
  publicBaseUrl: string;
  prefix: string;
};

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
  const envPyPath = path.join(process.cwd(), "env.py");
  try {
    const raw = await fs.readFile(envPyPath, "utf8");
    return parseEnvPyVars(raw);
  } catch {
    return {};
  }
}

function encodeObjectKey(objectName: string): string {
  return objectName
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function canonicalObjectName(objectName: string): string {
  return objectName.replace(/^\/+/, "").trim();
}

function buildBucketHost(config: OssConfig): string {
  return `${config.bucketName}.${config.endpoint}`;
}

function buildObjectUrl(config: OssConfig, objectName: string): string {
  return `https://${buildBucketHost(config)}/${encodeObjectKey(canonicalObjectName(objectName))}`;
}

function buildStringToSign(method: string, date: string, resource: string, contentType = ""): string {
  return `${method}\n\n${contentType}\n${date}\n${resource}`;
}

function sign(stringToSign: string, accessKeySecret: string): string {
  return createHmac("sha1", accessKeySecret).update(stringToSign, "utf8").digest("base64");
}

async function signedRequest(
  config: OssConfig,
  method: "GET" | "PUT" | "DELETE",
  objectName: string,
  opts?: {
    body?: string;
    contentType?: string;
    allowNotFound?: boolean;
  },
): Promise<Response> {
  const normalizedObject = canonicalObjectName(objectName);
  if (!normalizedObject) {
    throw new Error("OSS objectName 不能为空");
  }

  const date = new Date().toUTCString();
  const contentType = opts?.contentType ?? "";
  const resource = `/${config.bucketName}/${normalizedObject}`;
  const stringToSign = buildStringToSign(method, date, resource, contentType);
  const signature = sign(stringToSign, config.accessKeySecret);
  const authorization = `OSS ${config.accessKeyId}:${signature}`;

  const headers: Record<string, string> = {
    Date: date,
    Authorization: authorization,
  };
  if (contentType) {
    headers["Content-Type"] = contentType;
  }

  const response = await fetch(buildObjectUrl(config, normalizedObject), {
    method,
    headers,
    body: opts?.body,
    cache: "no-store",
  });

  if (response.status === 404 && opts?.allowNotFound) {
    return response;
  }
  if (!response.ok) {
    const detail = (await response.text()).trim().slice(0, 500);
    throw new Error(`OSS ${method} ${normalizedObject} 失败（${response.status}）：${detail || "无错误详情"}`);
  }
  return response;
}

export async function loadOssConfig(): Promise<OssConfig> {
  const envPy = await loadEnvPyVars();
  const endpoint = normalizeEndpoint(
    process.env.ALIYUN_OSS_ENDPOINT || process.env.OSS_ENDPOINT || envPy.endpoint || "",
  );

  return {
    accessKeyId: (process.env.ALIYUN_OSS_ACCESS_KEY_ID || process.env.OSS_ACCESS_KEY_ID || envPy.access_key_id || "")
      .trim(),
    accessKeySecret: (
      process.env.ALIYUN_OSS_ACCESS_KEY_SECRET ||
      process.env.OSS_ACCESS_KEY_SECRET ||
      envPy.access_key_secret ||
      ""
    ).trim(),
    bucketName: (process.env.ALIYUN_OSS_BUCKET_NAME || process.env.OSS_BUCKET_NAME || envPy.bucket_name || "").trim(),
    endpoint,
    publicBaseUrl: (
      process.env.ALIYUN_OSS_PUBLIC_BASE_URL ||
      process.env.OSS_PUBLIC_BASE_URL ||
      envPy.public_base_url ||
      ""
    ).trim(),
    prefix: (process.env.ALIYUN_OSS_PREFIX || process.env.OSS_PREFIX || envPy.prefix || "daily-news/reports").trim(),
  };
}

export function isOssConfigured(config: OssConfig): boolean {
  return Boolean(
    config.accessKeyId && config.accessKeySecret && config.bucketName && normalizeEndpoint(config.endpoint || ""),
  );
}

export function normalizePrefix(prefix: string): string {
  return (prefix || "").trim().replace(/^\/+|\/+$/g, "");
}

export function buildReportObjectName(prefix: string, fileName: string): string {
  const safeFileName = path.basename(fileName);
  const normalizedPrefix = normalizePrefix(prefix);
  return normalizedPrefix ? `${normalizedPrefix}/${safeFileName}` : safeFileName;
}

export function buildIndexObjectName(prefix: string): string {
  const normalizedPrefix = normalizePrefix(prefix);
  return normalizedPrefix ? `${normalizedPrefix}/index.json` : "index.json";
}

export function buildPublicOssUrl(config: OssConfig, objectName: string): string {
  const normalizedObject = canonicalObjectName(objectName);
  if (config.publicBaseUrl) {
    return `${config.publicBaseUrl.replace(/\/+$/, "")}/${encodeObjectKey(normalizedObject)}`;
  }
  return buildObjectUrl(config, normalizedObject);
}

export async function loadIndexItems(config: OssConfig, indexObjectName: string): Promise<Record<string, unknown>[]> {
  const resp = await signedRequest(config, "GET", indexObjectName, { allowNotFound: true });
  if (resp.status === 404) return [];
  const text = await resp.text();
  try {
    const parsed = JSON.parse(text) as { items?: unknown };
    const items = Array.isArray(parsed.items) ? parsed.items : [];
    return items.filter((item): item is Record<string, unknown> => !!item && typeof item === "object");
  } catch {
    return [];
  }
}

export async function putMarkdownObject(config: OssConfig, objectName: string, markdown: string): Promise<void> {
  await signedRequest(config, "PUT", objectName, {
    body: markdown,
    contentType: "text/markdown; charset=utf-8",
  });
}

export async function putJsonObject(config: OssConfig, objectName: string, payload: unknown): Promise<void> {
  const body = `${JSON.stringify(payload, null, 2)}\n`;
  await signedRequest(config, "PUT", objectName, {
    body,
    contentType: "application/json; charset=utf-8",
  });
}

export async function deleteObject(config: OssConfig, objectName: string): Promise<void> {
  await signedRequest(config, "DELETE", objectName, { allowNotFound: true });
}
