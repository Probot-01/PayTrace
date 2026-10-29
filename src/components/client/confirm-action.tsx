"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { api, ApiError } from "./api";
import { buttonStyles } from "@/components/ui";

/** A destructive action behind a confirmation dialog (native <dialog>: focus trap + Esc for free). */
export function ConfirmAction({
  label,
  title,
  body,
  confirmLabel,
  url,
  method = "DELETE",
  redirectTo,
  variant = "danger",
}: {
  label: string;
  title: string;
  body: string;
  confirmLabel: string;
  url: string;
  method?: string;
  redirectTo?: string;
  variant?: "danger" | "secondary";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <button
        type="button"
        className={variant === "danger" ? buttonStyles.secondary + " text-critical" : buttonStyles.secondary}
        onClick={() => ref.current?.showModal()}
      >
        {label}
      </button>
      <dialog
        ref={ref}
        aria-labelledby="confirm-title"
        className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-lg border border-line bg-surface p-5 text-ink"
        onClose={() => setError(null)}
      >
        <h2 id="confirm-title" className="text-lg font-semibold">
          {title}
        </h2>
        <p className="mt-2 text-sm text-ink-2">{body}</p>
        {error ? (
          <p role="alert" className="mt-3 rounded-md border border-critical/40 bg-critical-soft px-3 py-2 text-sm text-critical">
            {error}
          </p>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className={buttonStyles.ghost} onClick={() => ref.current?.close()} disabled={busy} autoFocus>
            Cancel
          </button>
          <button
            type="button"
            className={variant === "danger" ? buttonStyles.danger : buttonStyles.primary}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await api(url, { method });
                ref.current?.close();
                if (redirectTo) router.push(redirectTo);
                router.refresh();
              } catch (err) {
                setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </dialog>
    </>
  );
}
