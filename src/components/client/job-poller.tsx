"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "./api";

/** Polls a background job's status and refreshes the page when it finishes. Backs off on errors. */
export function JobPoller({ url, label }: { url: string; label: string }) {
  const router = useRouter();
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let delay = 1500;
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await api<{ status: string }>(url);
        setOffline(false);
        delay = 1500;
        if (res.status === "COMPLETED" || res.status === "FAILED") {
          router.refresh();
          return;
        }
      } catch {
        setOffline(true);
        delay = Math.min(delay * 2, 30_000);
      }
      if (!cancelled) timer = setTimeout(tick, delay);
    };
    timer = setTimeout(tick, delay);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [url, router]);

  return (
    <p role="status" className="flex items-center gap-2 text-sm text-ink-2">
      <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      {offline ? "Connection lost. Retrying…" : label}
    </p>
  );
}
