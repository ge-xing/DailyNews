#!/usr/bin/env python3
"""Run daily report generation as a background worker and persist status to files."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def tail_text(path: Path, max_lines: int = 20) -> str:
    if not path.exists():
        return ""
    try:
        lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()
        return "\n".join(lines[-max_lines:])
    except Exception:
        return ""


def find_latest_report_name() -> str:
    outputs = REPO_ROOT / "outputs"
    if not outputs.exists():
        return ""
    files = [
        p
        for p in outputs.glob("*.md")
        if "Karpathy 精选 RSS 日报" in p.name and "公众号格式" not in p.name and "素材" not in p.name
    ]
    if not files:
        return ""
    files.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return files[0].name


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Background generation worker.")
    parser.add_argument("--state-file", type=Path, required=True)
    parser.add_argument("--stdout-file", type=Path, required=True)
    parser.add_argument("--stderr-file", type=Path, required=True)
    parser.add_argument("--timeout-seconds", type=int, default=20 * 60)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    args.stdout_file.parent.mkdir(parents=True, exist_ok=True)
    args.stderr_file.parent.mkdir(parents=True, exist_ok=True)
    args.stdout_file.write_text("", encoding="utf-8")
    args.stderr_file.write_text("", encoding="utf-8")

    write_json(
        args.state_file,
        {
            "status": "running",
            "startedAt": now_iso(),
            "finishedAt": None,
            "message": "任务已启动，正在生成今日日报...",
            "exitCode": None,
            "latestReportName": "",
        },
    )

    exit_code = 1
    try:
        with args.stdout_file.open("wb") as out_f, args.stderr_file.open("wb") as err_f:
            proc = subprocess.Popen(
                ["bash", str(REPO_ROOT / "skill_m2h.sh")],
                cwd=str(REPO_ROOT),
                stdout=out_f,
                stderr=err_f,
            )
            try:
                exit_code = proc.wait(timeout=max(30, args.timeout_seconds))
            except subprocess.TimeoutExpired:
                proc.kill()
                exit_code = 124
    except Exception as exc:  # noqa: BLE001
        write_json(
            args.state_file,
            {
                "status": "failed",
                "startedAt": None,
                "finishedAt": now_iso(),
                "message": f"任务启动失败：{exc}",
                "exitCode": 1,
                "latestReportName": "",
            },
        )
        return 1

    stderr_tail = tail_text(args.stderr_file, max_lines=8).replace("\n", " | ")
    latest_report_name = find_latest_report_name()

    if exit_code == 0:
        message = "生成完成"
        if latest_report_name:
            message = f"生成完成：{latest_report_name}"
        status = "succeeded"
    elif exit_code == 124:
        status = "failed"
        message = "任务超时（20分钟），已自动终止。"
    else:
        status = "failed"
        message = f"执行失败（exit {exit_code}）：{stderr_tail or '无错误输出'}"

    previous_started_at = ""
    try:
        payload = json.loads(args.state_file.read_text(encoding="utf-8"))
        previous_started_at = str(payload.get("startedAt") or "")
    except Exception:
        previous_started_at = ""

    write_json(
        args.state_file,
        {
            "status": status,
            "startedAt": previous_started_at or now_iso(),
            "finishedAt": now_iso(),
            "message": message,
            "exitCode": exit_code,
            "latestReportName": latest_report_name,
        },
    )
    return 0 if exit_code == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
