"use client";

import Link from "next/link";
import { useState } from "react";
import { api, ApiError } from "@/components/client/api";
import { Field, FormError, Input, Spinner } from "@/components/client/form";
import { buttonStyles } from "@/components/ui";

export function LoginForm({ next }: { next: string }) {
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      await api("/api/auth/login", { json: { email: form.get("email"), password: form.get("password") } });
      // Full page load so the new session cookie applies to every server component.
      window.location.assign(next);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setFieldErrors(err.fieldErrors());
      } else setError("Sign-in failed. Try again.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <FormError message={error} />
      <Field label="Work email" error={fieldErrors.email?.[0]}>
        {(p) => <Input {...p} name="email" type="email" autoComplete="username" required autoFocus />}
      </Field>
      <Field label="Password" error={fieldErrors.password?.[0]}>
        {(p) => <Input {...p} name="password" type="password" autoComplete="current-password" required />}
      </Field>
      <button type="submit" className={`${buttonStyles.primary} w-full`} disabled={busy}>
        {busy ? <Spinner label="Signing in" /> : null}
        {busy ? "Signing in…" : "Sign in"}
      </button>
      <p className="text-center text-sm">
        <Link href="/forgot-password" className="text-accent underline underline-offset-2 hover:decoration-2">
          Forgot your password?
        </Link>
      </p>
    </form>
  );
}
