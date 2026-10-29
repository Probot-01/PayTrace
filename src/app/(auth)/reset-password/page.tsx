import type { Metadata } from "next";
import Link from "next/link";
import { ResetForm } from "./reset-form";

export const metadata: Metadata = { title: "Choose a password", referrer: "no-referrer" };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <div className="rounded-lg border border-line bg-surface p-6">
      <h1 className="text-xl font-semibold">Choose a password</h1>
      {token ? (
        <>
          <p className="mb-5 mt-1 text-sm text-ink-2">Use at least 12 characters. A short phrase is easier to remember than symbols.</p>
          <ResetForm token={token} />
        </>
      ) : (
        <p className="mt-2 text-sm text-ink-2">
          This page needs the link from your invitation or reset email.{" "}
          <Link href="/forgot-password" className="text-accent underline underline-offset-2 hover:decoration-2">
            Request a new link
          </Link>
          .
        </p>
      )}
    </div>
  );
}
