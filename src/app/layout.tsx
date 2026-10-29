import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "PayTrace", template: "%s · PayTrace" },
  description: "Payment reconciliation and failure detection for UPI, cards, NEFT and RTGS.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f6f3" },
    { media: "(prefers-color-scheme: dark)", color: "#0d0d0d" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Reading request headers makes every route render per request, which the nonce-based CSP requires.
  await headers();
  return (
    <html lang="en-IN">
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
