"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type DeleteResponse = {
  ok: boolean;
  message: string;
};

type DeleteReportButtonProps = {
  slug: string;
  title: string;
};

export function DeleteReportButton({ slug, title }: DeleteReportButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isDeleting, setIsDeleting] = useState(false);

  async function onDelete() {
    const confirmed = window.confirm(`确认删除这篇日报吗？\n\n${title}`);
    if (!confirmed) return;

    setIsDeleting(true);
    try {
      const resp = await fetch(`/api/reports/${encodeURIComponent(slug)}`, {
        method: "DELETE",
        cache: "no-store",
      });
      const data = (await resp.json()) as DeleteResponse;
      if (!resp.ok || !data.ok) {
        throw new Error(data.message || "删除失败");
      }
      startTransition(() => {
        router.refresh();
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "删除失败";
      window.alert(`删除失败：${message}`);
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <button
      type="button"
      className="delete-report-btn"
      onClick={onDelete}
      disabled={isDeleting || isPending}
      title="删除这期日报"
      aria-label="删除这期日报"
    >
      {isDeleting || isPending ? "..." : "删除"}
    </button>
  );
}
