import { promisify } from "node:util";
import { execFile as execFileCallback } from "node:child_process";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const execFile = promisify(execFileCallback);
const ORDER_BY_VALUES = new Set(["this_week", "this_month", "this_year", "last_hour", "today"]);

type SearchBody = {
  keyword?: string;
  videoCount?: number;
  orderBy?: string;
  languageCode?: string;
  countryCode?: string;
};

function clampVideoCount(value: number | undefined): number {
  if (!Number.isFinite(value)) return 30;
  const n = Math.floor(Number(value));
  return Math.max(1, Math.min(100, n));
}

function toSafeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request) {
  let body: SearchBody = {};
  try {
    body = (await request.json()) as SearchBody;
  } catch {
    return NextResponse.json(
      {
        ok: false,
        message: "请求体必须是 JSON。",
      },
      { status: 400 },
    );
  }

  const keyword = toSafeText(body.keyword);
  if (!keyword) {
    return NextResponse.json(
      {
        ok: false,
        message: "关键词不能为空。",
      },
      { status: 400 },
    );
  }

  const videoCount = clampVideoCount(body.videoCount);
  const orderBy = ORDER_BY_VALUES.has(toSafeText(body.orderBy)) ? toSafeText(body.orderBy) : "this_month";
  const languageCode = toSafeText(body.languageCode) || "en";
  const countryCode = toSafeText(body.countryCode) || "us";

  const scriptPath = path.join(process.cwd(), "scripts", "run_youtube_videos_analysis.py");
  const args = [
    scriptPath,
    "--search-query",
    keyword,
    "--video-count",
    String(videoCount),
    "--order-by",
    orderBy,
    "--language-code",
    languageCode,
    "--country-code",
    countryCode,
  ];

  try {
    const { stdout } = await execFile("python3", args, {
      cwd: process.cwd(),
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
      env: process.env,
    });

    const text = stdout.trim();
    if (!text) {
      throw new Error("脚本未返回内容。");
    }

    const data = JSON.parse(text) as Record<string, unknown>;
    return NextResponse.json(
      {
        ok: true,
        data,
      },
      { status: 200 },
    );
  } catch (error) {
    let message = "YouTube 热点搜索失败。";
    if (error instanceof Error && error.message) {
      message = error.message;
    }
    return NextResponse.json(
      {
        ok: false,
        message,
      },
      { status: 500 },
    );
  }
}
