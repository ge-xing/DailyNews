import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";
import {
  buildIndexObjectName,
  buildPublicOssUrl,
  buildReportObjectName,
  deleteObject,
  isOssConfigured,
  loadIndexItems,
  loadOssConfig,
  putJsonObject,
} from "@/lib/oss";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteParams = {
  params: Promise<{ slug: string }>;
};

function decodeSlug(slug: string): string | null {
  try {
    const fileName = Buffer.from(slug, "base64url").toString("utf8");
    if (!fileName || path.basename(fileName) !== fileName) {
      return null;
    }
    return fileName;
  } catch {
    return null;
  }
}

async function deleteLocalArtifacts(fileName: string) {
  const safeName = path.basename(fileName);
  const ext = path.extname(safeName);
  const stem = ext ? safeName.slice(0, -ext.length) : safeName;
  const outputDirs = [path.join(process.cwd(), "outputs"), path.join(tmpdir(), "daily-news", "outputs")];

  for (const outputsDir of outputDirs) {
    const reportPath = path.join(outputsDir, safeName);
    const wechatPath = path.join(outputsDir, `${stem} - 公众号格式${ext || ".md"}`);
    const materialsDir = path.join(outputsDir, `${stem}素材`);

    const targets = [reportPath, wechatPath];
    for (const target of targets) {
      try {
        await fs.rm(target, { force: true });
      } catch {
        // ignore local cleanup errors
      }
    }

    try {
      await fs.rm(materialsDir, { recursive: true, force: true });
    } catch {
      // ignore local cleanup errors
    }
  }
}

function compareByFileNameDesc(a: Record<string, unknown>, b: Record<string, unknown>): number {
  const af = String(a.fileName || "");
  const bf = String(b.fileName || "");
  return bf.localeCompare(af);
}

async function deleteFromOss(fileName: string): Promise<{ objectName?: string; indexUpdated: boolean }> {
  const config = await loadOssConfig();
  if (!isOssConfigured(config)) {
    return { indexUpdated: false };
  }

  const indexObjectName = buildIndexObjectName(config.prefix);
  const items = await loadIndexItems(config, indexObjectName);

  let objectName = "";
  const remaining: Record<string, unknown>[] = [];
  for (const item of items) {
    const itemFileName = String(item.fileName || "").trim();
    if (!objectName && itemFileName === fileName) {
      objectName = String(item.objectName || "").trim();
      continue;
    }
    remaining.push(item);
  }

  if (!objectName) {
    objectName = buildReportObjectName(config.prefix, fileName);
  }

  await deleteObject(config, objectName);
  const nextItems = remaining.sort(compareByFileNameDesc);
  await putJsonObject(config, indexObjectName, {
    generated_at: new Date().toISOString(),
    count: nextItems.length,
    prefix: config.prefix,
    items: nextItems,
  });

  return {
    objectName,
    indexUpdated: true,
  };
}

export async function DELETE(_: Request, { params }: RouteParams) {
  const { slug } = await params;
  const fileName = decodeSlug(slug);
  if (!fileName) {
    return NextResponse.json(
      {
        ok: false,
        message: "无效的日报标识。",
      },
      { status: 400 },
    );
  }

  try {
    const ossResult = await deleteFromOss(fileName);
    await deleteLocalArtifacts(fileName);

    let deletedUrl = "";
    if (ossResult.objectName) {
      const config = await loadOssConfig();
      if (isOssConfigured(config)) {
        deletedUrl = buildPublicOssUrl(config, ossResult.objectName);
      }
    }

    return NextResponse.json(
      {
        ok: true,
        message: `已删除：${fileName}`,
        objectName: ossResult.objectName || "",
        deletedUrl,
      },
      { status: 200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "删除失败";
    return NextResponse.json(
      {
        ok: false,
        message,
      },
      { status: 500 },
    );
  }
}
