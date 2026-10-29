import type { Metadata } from "next";
import { ForgotForm } from "./forgot-form";

export const metadata: Metadata = { title: "Reset password" };

export default function ForgotPasswordPage() {
  return (
    <div className="rounded-lg border border-line bg-surface p-6">
      <h1 className="text-xl font-semibold">Reset your password</h1>
      <p className="mb-5 mt-1 text-sm text-ink-2">Enter your work email. If it belongs to an active account, we will email a link that is valid for 30 minutes.</p>
      <ForgotForm />
    </div>
  );
}
