"use client";

import { useState } from "react";
import { api, ApiError } from "@/components/client/api";
import { Field, FormError, Input } from "@/components/client/form";
import { buttonStyles } from "@/components/ui";

export function ResetForm({ token }: { token: string }) {
  const [error, setError] = useState<string | null>(null);
  const [mismatch, setMismatch] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const password = String(form.get("password") ?? "");
    if (password !== form.get("confirm")) {
      setMismatch("The two passwords do not match.");
      return;
    }
    setMismatch(undefined);
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/reset-password", { json: { token, password } });
      window.location.assign("/login?reset=1");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <FormError message={error} />
      <Field label="New password" hint="12–128 characters.">
        {(p) => <Input {...p} name="password" type="password" autoComplete="new-password" minLength={12} required />}
      </Field>
      <Field label="Confirm new password" error={mismatch}>
        {(p) => <Input {...p} name="confirm" type="password" autoComplete="new-password" required />}
      </Field>
      <button type="submit" className={`${buttonStyles.primary} w-full`} disabled={busy}>
        {busy ? "Saving…" : "Set password"}
      </button>
    </form>
  );
}
