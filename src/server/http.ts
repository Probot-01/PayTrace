import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z, ZodError } from "zod";
import { env } from "@/lib/env";
import { AppError, badRequest, forbidden, isAppError, unauthenticated, validationFailed } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { AuditActor } from "./audit";
import { can, type Permission } from "./auth/permissions";
import { SESSION_COOKIE, validateSessionToken, type SessionUser } from "./auth/session";

export interface RequestContext {
  user: SessionUser;
  sessionId: string;
  ip: string | null;
  actor: AuditActor;
  requestId: string;
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const MAX_JSON_BYTES = 1024 * 1024;

/** Client IP from X-Forwarded-For, trusting only the configured number of proxy hops. */
export function clientIp(headers: Headers): string | null {
  const hops = env().TRUSTED_PROXY_HOPS;
  if (hops === 0) return null;
  const chain = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const ip = chain[chain.length - hops];
  return ip && ip.length <= 64 ? ip : null;
}

/**
 * CSRF defence in depth: session cookies are SameSite=Lax, and every state-changing request must
 * come from our own origin (Origin header, falling back to Fetch Metadata).
 */
export function assertSameOrigin(req: Request) {
  const expected = new URL(env().APP_URL).origin;
  const origin = req.headers.get("origin");
  if (origin) {
    if (origin !== expected) throw forbidden("Cross-site request blocked.");
    return;
  }
  const site = req.headers.get("sec-fetch-site");
  if (site !== "same-origin") throw forbidden("Cross-site request blocked.");
}

export function errorResponse(err: unknown, requestId: string): NextResponse {
  if (isAppError(err)) {
    const res = NextResponse.json({ error: { code: err.code, message: err.message, details: err.details ?? null } }, { status: err.status });
    if (err.status === 429) {
      const retry = (err.details as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds;
      if (retry) res.headers.set("Retry-After", String(retry));
    }
    return res;
  }
  if (err instanceof ZodError) {
    return errorResponse(validationFailed(z.flattenError(err)), requestId);
  }
  logger.error({ err, requestId }, "unhandled API error");
  return NextResponse.json(
    { error: { code: "INTERNAL", message: "Something went wrong on our side. Try again; if it persists, quote reference " + requestId + ".", details: null } },
    { status: 500 },
  );
}

export async function readJson<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  const type = req.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) throw badRequest("Expected a JSON body.");
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_JSON_BYTES) throw badRequest("Request body is too large.");
  let body: unknown;
  try {
    const text = await req.text();
    if (text.length > MAX_JSON_BYTES) throw badRequest("Request body is too large.");
    body = JSON.parse(text);
  } catch (e) {
    if (isAppError(e)) throw e;
    throw badRequest("Malformed JSON body.");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw validationFailed(z.flattenError(parsed.error));
  return parsed.data;
}

export function parseQuery<T extends z.ZodType>(req: NextRequest, schema: T): z.infer<T> {
  const raw = Object.fromEntries(req.nextUrl.searchParams.entries());
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw validationFailed(z.flattenError(parsed.error), "Invalid query parameters.");
  return parsed.data;
}

type RouteParams = { params: Promise<Record<string, string>> };

/**
 * Wraps a route handler with authentication, authorisation, CSRF checks and uniform error JSON.
 * Authorisation is enforced here (and again inside services for resource-level rules), never only in the UI.
 */
export function apiRoute(
  options: { permission: Permission },
  handler: (req: NextRequest, ctx: RequestContext, params: Record<string, string>) => Promise<Response>,
) {
  return async (req: NextRequest, route: RouteParams): Promise<Response> => {
    const requestId = randomUUID();
    try {
      if (MUTATING.has(req.method)) assertSameOrigin(req);
      const session = await validateSessionToken(req.cookies.get(SESSION_COOKIE())?.value);
      if (!session) throw unauthenticated();
      if (!can(session.user.role, options.permission)) throw forbidden();
      const ip = clientIp(req.headers);
      const ctx: RequestContext = {
        user: session.user,
        sessionId: session.sessionId,
        ip,
        actor: { id: session.user.id, email: session.user.email, ip },
        requestId,
      };
      const res = await handler(req, ctx, (await route?.params) ?? {});
      res.headers.set("Cache-Control", "no-store");
      res.headers.set("X-Request-Id", requestId);
      return res;
    } catch (err) {
      const res = errorResponse(err, requestId);
      res.headers.set("X-Request-Id", requestId);
      return res;
    }
  };
}

/** For unauthenticated endpoints (login, password reset): CSRF + error handling only. */
export function publicRoute(handler: (req: NextRequest, meta: { ip: string | null; requestId: string }) => Promise<Response>) {
  return async (req: NextRequest): Promise<Response> => {
    const requestId = randomUUID();
    try {
      if (MUTATING.has(req.method)) assertSameOrigin(req);
      const res = await handler(req, { ip: clientIp(req.headers), requestId });
      res.headers.set("Cache-Control", "no-store");
      return res;
    } catch (err) {
      return errorResponse(err, requestId);
    }
  };
}

export { AppError };
