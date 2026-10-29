export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="on-dark flex min-h-dvh items-center justify-center bg-brand px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2">
          <svg aria-hidden width="28" height="28" viewBox="0 0 32 32">
            <rect width="32" height="32" rx="7" fill="var(--nav)" />
            <path d="M8 21l5-6 4 3 7-9" fill="none" stroke="var(--nav-active)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="text-lg font-semibold tracking-tight text-brand-ink">PayTrace</span>
        </div>
        {children}
      </div>
    </main>
  );
}
