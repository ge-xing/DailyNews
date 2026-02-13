"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type GenerateResponse = {
  ok: boolean;
  status?: "idle" | "running" | "succeeded" | "failed";
  message: string;
  stderrTail?: string;
  stdoutTail?: string;
};

export function GenerateTodayButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isGenerating, setIsGenerating] = useState(false);
  const [status, setStatus] = useState("");

  async function fetchGenerateStatus() {
    const resp = await fetch("/api/generate", {
      method: "GET",
      cache: "no-store",
    });
    const data = (await resp.json()) as GenerateResponse;
    return data;
  }

  async function waitForCompletion() {
    const maxRounds = 25 * 30; // 25 minutes, 2s per round.
    for (let i = 0; i < maxRounds; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const data = await fetchGenerateStatus();

      if (data.status === "running") {
        const latest = (data.stderrTail || "").split("\n").filter(Boolean).slice(-1)[0];
        const runningMessage = latest ? `正在生成：${latest}` : data.message || "正在生成今日日报，请稍候...";
        setStatus(runningMessage);
        continue;
      }

      if (data.status === "succeeded") {
        setStatus(data.message || "今日日报已生成。");
        startTransition(() => {
          router.refresh();
        });
        return;
      }

      if (data.status === "failed") {
        const tail = (data.stderrTail || "").split("\n").slice(-2).join(" | ");
        throw new Error(tail ? `${data.message} | ${tail}` : data.message || "生成失败");
      }
    }
    throw new Error("等待超时，请稍后刷新页面查看结果。");
  }

  async function handleGenerate() {
    if (isGenerating) return;
    setIsGenerating(true);
    setStatus("正在创建生成任务...");

    try {
      const resp = await fetch("/api/generate", {
        method: "POST",
        cache: "no-store",
      });
      const data = (await resp.json()) as GenerateResponse;
      if (!resp.ok && resp.status !== 409) {
        throw new Error(data.message || "启动任务失败");
      }

      setStatus(data.message || "任务已启动，正在生成...");
      await waitForCompletion();
    } catch (error) {
      const message = error instanceof Error ? error.message : "生成失败";
      setStatus(`生成失败：${message}`);
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <div className="generate-wrap">
      <button className="btn btn-outline" onClick={handleGenerate} disabled={isGenerating || isPending}>
        {isGenerating || isPending ? "生成中..." : "生成今日日报"}
      </button>
      {status ? <p className="generate-status">{status}</p> : null}
    </div>
  );
}
