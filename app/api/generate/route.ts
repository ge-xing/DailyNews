import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type JobStatus = "idle" | "running" | "succeeded" | "failed";

type GenerateJobState = {
  status: JobStatus;
  startedAt: string | null;
  finishedAt: string | null;
  message: string;
  exitCode: number | null;
  latestReportName: string;
};

const RUNTIME_DIR = path.join(process.cwd(), ".runtime", "generate-job");
const STATE_FILE = path.join(RUNTIME_DIR, "state.json");
const STDOUT_FILE = path.join(RUNTIME_DIR, "stdout.log");
const STDERR_FILE = path.join(RUNTIME_DIR, "stderr.log");
const WORKER_SCRIPT = path.join(process.cwd(), "scripts", "run_generate_job.py");

const JOB_TIMEOUT_SECONDS = 20 * 60;
const RUNNING_STALE_MS = (JOB_TIMEOUT_SECONDS + 120) * 1000;
const MAX_TAIL_LINES = 25;

const DEFAULT_STATE: GenerateJobState = {
  status: "idle",
  startedAt: null,
  finishedAt: null,
  message: "暂无任务",
  exitCode: null,
  latestReportName: "",
};

function nowIso() {
  return new Date().toISOString();
}

function serializeState(state: GenerateJobState, stdoutTail: string, stderrTail: string) {
  return {
    ok: state.status !== "failed",
    status: state.status,
    startedAt: state.startedAt,
    finishedAt: state.finishedAt,
    message: state.message,
    exitCode: state.exitCode,
    latestReportName: state.latestReportName,
    stdoutTail,
    stderrTail,
  };
}

async function ensureRuntimeDir() {
  await fs.mkdir(RUNTIME_DIR, { recursive: true });
}

async function readTail(filePath: string): Promise<string> {
  try {
    const content = await fs.readFile(filePath, "utf8");
    const lines = content.split("\n").map((line) => line.trimEnd()).filter(Boolean);
    return lines.slice(-MAX_TAIL_LINES).join("\n");
  } catch {
    return "";
  }
}

async function writeState(state: GenerateJobState) {
  await ensureRuntimeDir();
  await fs.writeFile(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

async function readState(): Promise<GenerateJobState> {
  try {
    const raw = await fs.readFile(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<GenerateJobState>;
    return {
      status: parsed.status ?? DEFAULT_STATE.status,
      startedAt: parsed.startedAt ?? DEFAULT_STATE.startedAt,
      finishedAt: parsed.finishedAt ?? DEFAULT_STATE.finishedAt,
      message: parsed.message ?? DEFAULT_STATE.message,
      exitCode: parsed.exitCode ?? DEFAULT_STATE.exitCode,
      latestReportName: parsed.latestReportName ?? DEFAULT_STATE.latestReportName,
    };
  } catch {
    return DEFAULT_STATE;
  }
}

async function normalizeStaleRunningState(state: GenerateJobState): Promise<GenerateJobState> {
  if (state.status !== "running" || !state.startedAt) return state;
  const startedAtMs = Date.parse(state.startedAt);
  if (Number.isNaN(startedAtMs)) return state;
  if (Date.now() - startedAtMs <= RUNNING_STALE_MS) return state;

  const nextState: GenerateJobState = {
    ...state,
    status: "failed",
    finishedAt: nowIso(),
    message: "任务状态过期（超过20分钟），请重试生成。",
    exitCode: 124,
  };
  await writeState(nextState);
  return nextState;
}

async function getStateWithTail() {
  const rawState = await readState();
  const state = await normalizeStaleRunningState(rawState);
  const [stdoutTail, stderrTail] = await Promise.all([readTail(STDOUT_FILE), readTail(STDERR_FILE)]);
  return { state, stdoutTail, stderrTail };
}

function spawnWorker() {
  const child = spawn(
    "python3",
    [
      WORKER_SCRIPT,
      "--state-file",
      STATE_FILE,
      "--stdout-file",
      STDOUT_FILE,
      "--stderr-file",
      STDERR_FILE,
      "--timeout-seconds",
      String(JOB_TIMEOUT_SECONDS),
    ],
    {
      cwd: process.cwd(),
      env: process.env,
      detached: true,
      stdio: "ignore",
    },
  );
  child.on("error", async (error) => {
    const failedState: GenerateJobState = {
      status: "failed",
      startedAt: nowIso(),
      finishedAt: nowIso(),
      message: `任务启动失败：${error.message}`,
      exitCode: 1,
      latestReportName: "",
    };
    try {
      await writeState(failedState);
    } catch {
      // Ignore write failures here; GET fallback will still show stale state handling.
    }
  });
  child.unref();
}

export async function GET() {
  const { state, stdoutTail, stderrTail } = await getStateWithTail();
  return NextResponse.json(serializeState(state, stdoutTail, stderrTail), { status: 200 });
}

export async function POST() {
  const { state } = await getStateWithTail();
  if (state.status === "running") {
    return NextResponse.json(
      {
        ok: false,
        status: "running",
        message: "已有生成任务在运行，已切换为跟踪模式。",
      },
      { status: 409 },
    );
  }

  const runningState: GenerateJobState = {
    status: "running",
    startedAt: nowIso(),
    finishedAt: null,
    message: "任务已启动，正在生成今日日报...",
    exitCode: null,
    latestReportName: "",
  };

  try {
    await writeState(runningState);
    await ensureRuntimeDir();
    await fs.writeFile(STDOUT_FILE, "", "utf8");
    await fs.writeFile(STDERR_FILE, "", "utf8");
    spawnWorker();
  } catch (error) {
    const failedState: GenerateJobState = {
      status: "failed",
      startedAt: runningState.startedAt,
      finishedAt: nowIso(),
      message: `任务启动失败：${error instanceof Error ? error.message : "未知错误"}`,
      exitCode: 1,
      latestReportName: "",
    };
    await writeState(failedState);
    return NextResponse.json(
      {
        ok: false,
        status: "failed",
        message: failedState.message,
      },
      { status: 500 },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      status: "running",
      message: runningState.message,
    },
    { status: 202 },
  );
}
