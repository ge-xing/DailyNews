import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

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

function runDeleteScript(fileName: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const cwd = process.cwd();
    const scriptPath = path.join(cwd, "scripts", "delete_oss_report.py");
    const child = spawn("python3", [scriptPath, "--file-name", fileName], {
      cwd,
      env: process.env,
    });

    let stdout = "";
    let stderr = "";

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("删除超时（120秒）"));
    }, 120_000);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

function parseJsonFromStdout(stdout: string): Record<string, unknown> | null {
  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;
  const last = lines[lines.length - 1];
  try {
    const parsed = JSON.parse(last) as Record<string, unknown>;
    return parsed;
  } catch {
    return null;
  }
}

async function deleteLocalArtifacts(fileName: string) {
  const outputsDir = path.join(process.cwd(), "outputs");
  const safeName = path.basename(fileName);
  const reportPath = path.join(outputsDir, safeName);

  const ext = path.extname(safeName);
  const stem = ext ? safeName.slice(0, -ext.length) : safeName;
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
    const { code, stdout, stderr } = await runDeleteScript(fileName);
    const payload = parseJsonFromStdout(stdout);

    if (code !== 0) {
      const message =
        (payload?.message as string | undefined) ||
        stderr.trim().split("\n").slice(-2).join(" | ") ||
        "删除失败";
      return NextResponse.json(
        {
          ok: false,
          message,
        },
        { status: 500 },
      );
    }

    await deleteLocalArtifacts(fileName);

    return NextResponse.json(
      {
        ok: true,
        message: (payload?.fileName as string | undefined)
          ? `已删除：${String(payload?.fileName)}`
          : "删除成功",
        objectName: payload?.objectName,
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
