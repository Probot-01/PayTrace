import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="max-w-md text-center">
        <p className="text-sm font-medium text-ink-3">404</p>
        <h1 className="mt-1 text-2xl font-semibold">Page not found</h1>
        <p className="mt-2 text-sm text-ink-2">The link may be mistyped, or the record was deleted.</p>
        <Link href="/" className="mt-5 inline-block rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-ink hover:bg-accent-hover">
          Go to dashboard
        </Link>
      </div>
    </main>
  );
}
