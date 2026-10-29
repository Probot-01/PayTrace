"use client";

import Link from "next/link";
import { useState } from "react";
import { api, ApiError } from "@/components/client/api";
import { Field, FormError, Input } from "@/components/client/form";
import { buttonStyles } from "@/components/ui";

export function ForgotForm() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/forgot-password", { json: { email: new FormData(e.currentTarget).get("email") } });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="space-y-4">
        <p role="status" className="rounded-md border border-good/40 bg-good-soft px-3 py-2 text-sm text-good">
          If that email belongs to an active account, a reset link is on its way. If email is not configured for your organisation, ask an
          administrator to issue a reset link from the Users page.
        </p>
        <Link href="/login" className="text-sm text-accent hover:underline">
          Back to sign in
        </Link>
      </div>
    );
  }
  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <FormError message={error} />
      <Field label="Work email">{(p) => <Input {...p} name="email" type="email" autoComplete="email" required />}</Field>
      <button type="submit" className={`${buttonStyles.primary} w-full`} disabled={busy}>
        {busy ? "Sending…" : "Send reset link"}
      </button>
      <p className="text-center text-sm">
        <Link href="/login" className="text-accent underline underline-offset-2 hover:decoration-2">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
