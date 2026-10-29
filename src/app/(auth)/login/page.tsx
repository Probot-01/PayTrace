import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/server/auth/current";
import { safeNextPath } from "@/lib/safe-redirect";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; reset?: string }> }) {
  const params = await searchParams;
  const next = safeNextPath(params.next);
  if (await getSession()) redirect(next);
  return (
    <div className="rounded-lg border border-line bg-surface p-6">
      <h1 className="text-xl font-semibold">Sign in</h1>
      <p className="mb-5 mt-1 text-sm text-ink-2">Reconciliation workspace for payment operations teams.</p>
      {params.reset === "1" ? (
        <p role="status" className="mb-4 rounded-md border border-good/40 bg-good-soft px-3 py-2 text-sm text-good">
          Password updated. Sign in with your new password.
        </p>
      ) : null}
      <LoginForm next={next} />
    </div>
  );
}
