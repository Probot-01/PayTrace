export default function Loading() {
  return (
    <div role="status" aria-live="polite" className="space-y-4">
      <span className="sr-only">Loading…</span>
      <div className="h-8 w-64 animate-pulse rounded bg-surface-2" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-lg bg-surface-2" />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-lg bg-surface-2" />
    </div>
  );
}
