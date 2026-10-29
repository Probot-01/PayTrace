/** Only same-site relative paths are allowed as post-login destinations (no open redirects). */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || typeof next !== "string") return "/";
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\") || next.includes("\n") || next.length > 500) return "/";
  if (next.startsWith("/login") || next.startsWith("/api/")) return "/";
  return next;
}
