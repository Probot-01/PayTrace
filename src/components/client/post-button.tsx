"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiError } from "./api";
import { buttonStyles } from "@/components/ui";

/** Fires a JSON POST and navigates to the created resource (e.g. "re-run"). */
export function PostButton({ url, body, label, navigateTo, variant = "secondary" }: { url: string; body: unknown; label: string; navigateTo: (res: { id: string }) => string; variant?: "primary" | "secondary" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col">
      <button
        type="button"
        className={buttonStyles[variant]}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const res = await api<{ id: string }>(url, { json: body });
            router.push(navigateTo(res));
          } catch (err) {
            setError(err instanceof ApiError ? err.message : "Request failed.");
            setBusy(false);
          }
        }}
      >
        {busy ? "Working…" : label}
      </button>
      {error ? (
        <span role="alert" className="mt-1 text-xs text-critical">
          {error}
        </span>
      ) : null}
    </span>
  );
}
