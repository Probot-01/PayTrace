"use client";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly details: unknown,
  ) {
    super(message);
  }

  /** Field-level messages from a 422 response, keyed by field name. */
  fieldErrors(): Record<string, string[]> {
    const d = this.details as { fieldErrors?: Record<string, string[]> } | null;
    return d?.fieldErrors ?? {};
  }
}

/** JSON fetch with uniform error handling. Expired sessions bounce to sign-in. */
export async function api<T = unknown>(url: string, init: { method?: string; json?: unknown; form?: FormData } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method ?? (init.json !== undefined || init.form ? "POST" : "GET"),
      headers: init.json !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: init.form ?? (init.json !== undefined ? JSON.stringify(init.json) : undefined),
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError("Could not reach the server. Check your connection and try again.", 0, "NETWORK", null);
  }
  if (res.status === 401 && !url.startsWith("/api/auth/")) {
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- full reload drops stale client state
    window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
    throw new ApiError("Your session has expired.", 401, "UNAUTHENTICATED", null);
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const err = (data as { error?: { message?: string; code?: string; details?: unknown } } | null)?.error;
    throw new ApiError(err?.message ?? `Request failed (${res.status}).`, res.status, err?.code ?? "HTTP_ERROR", err?.details ?? null);
  }
  return data as T;
}
