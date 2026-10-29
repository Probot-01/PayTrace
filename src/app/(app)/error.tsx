"use client";

import { useEffect } from "react";
import { buttonStyles } from "@/components/ui";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div role="alert" className="mx-auto max-w-lg py-16 text-center">
      <h1 className="text-xl font-semibold">This page could not load</h1>
      <p className="mt-2 text-sm text-ink-2">
        A temporary problem stopped the page from loading. Your data is safe. Try again; if it keeps happening, share reference{" "}
        <span className="mono">{error.digest ?? "n/a"}</span> with your administrator.
      </p>
      <button type="button" className={`${buttonStyles.primary} mt-5`} onClick={reset}>
        Try again
      </button>
    </div>
  );
}
