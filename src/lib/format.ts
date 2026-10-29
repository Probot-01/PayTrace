const dateTime = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const timeOnly = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
const dateOnly = new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric" });

/** All timestamps are shown in IST, the zone Indian payment systems settle in. */
export function formatDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return `${dateTime.format(new Date(d))} IST`;
}

export function formatTime(d: Date | string): string {
  return timeOnly.format(new Date(d));
}

/** Formats a YYYY-MM-DD business date. */
export function formatBusinessDate(d: string): string {
  return dateOnly.format(new Date(`${d}T00:00:00Z`));
}

export function shortBusinessDate(d: string): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", day: "2-digit", month: "short" }).format(new Date(`${d}T00:00:00Z`));
}

/** "due in 3h", "overdue by 2d" */
export function relativeDue(due: Date | string, now = new Date()): { text: string; overdue: boolean } {
  const ms = new Date(due).getTime() - now.getTime();
  const abs = Math.abs(ms);
  const mins = Math.round(abs / 60_000);
  const span = mins < 60 ? `${mins}m` : mins < 48 * 60 ? `${Math.round(mins / 60)}h` : `${Math.round(mins / 1440)}d`;
  return ms >= 0 ? { text: `due in ${span}`, overdue: false } : { text: `overdue by ${span}`, overdue: true };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function todayIst(): string {
  return new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
}
