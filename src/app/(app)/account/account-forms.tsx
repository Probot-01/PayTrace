"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { api, ApiError } from "@/components/client/api";
import { Field, FormError, Input } from "@/components/client/form";
import { buttonStyles } from "@/components/ui";

function ChangePassword() {
  const ref = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [done, setDone] = useState(false);
  return (
    <form
      ref={ref}
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setError(null);
        setFieldErrors({});
        setDone(false);
        if (f.get("newPassword") !== f.get("confirm")) {
          setFieldErrors({ confirm: ["The two passwords do not match."] });
          return;
        }
        setBusy(true);
        try {
          await api("/api/v1/account/password", { json: { currentPassword: f.get("currentPassword"), newPassword: f.get("newPassword") } });
          setDone(true);
          ref.current?.reset();
        } catch (err) {
          if (err instanceof ApiError) {
            setError(err.message);
            setFieldErrors(err.fieldErrors());
          } else setError("Could not change the password.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <FormError message={error} />
      {done ? (
        <p role="status" className="rounded-md border border-good/40 bg-good-soft px-3 py-2 text-sm text-good">
          Password changed. Your other sessions were signed out.
        </p>
      ) : null}
      <Field label="Current password" error={fieldErrors.currentPassword?.[0]}>
        {(p) => <Input {...p} name="currentPassword" type="password" autoComplete="current-password" required />}
      </Field>
      <Field label="New password" hint="At least 12 characters." error={fieldErrors.newPassword?.[0]}>
        {(p) => <Input {...p} name="newPassword" type="password" autoComplete="new-password" required minLength={12} />}
      </Field>
      <Field label="Confirm new password" error={fieldErrors.confirm?.[0]}>
        {(p) => <Input {...p} name="confirm" type="password" autoComplete="new-password" required />}
      </Field>
      <button type="submit" className={buttonStyles.primary} disabled={busy}>
        {busy ? "Saving…" : "Change password"}
      </button>
    </form>
  );
}

function RevokeSession({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="flex shrink-0 flex-col items-end">
      <button
        type="button"
        className="text-sm text-accent hover:underline disabled:opacity-50"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await api("/api/v1/account/sessions", { method: "DELETE", json: { sessionId } });
            router.refresh();
          } catch (err) {
            setError(err instanceof ApiError ? err.message : "Failed");
            setBusy(false);
          }
        }}
      >
        {busy ? "Signing out…" : "Sign out"}
      </button>
      {error ? <span className="text-xs text-critical">{error}</span> : null}
    </span>
  );
}

export { ChangePassword, RevokeSession };
