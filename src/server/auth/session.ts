import { and, eq, lt, ne } from "drizzle-orm";
import { getDb } from "@/db";
import { sessions, users } from "@/db/schema";
import { env, isProduction } from "@/lib/env";
import type { UserRole } from "@/domain/types";
import { generateToken, hashToken } from "./tokens";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

export interface ValidSession {
  sessionId: string;
  expiresAt: Date;
  user: SessionUser;
}

export const SESSION_COOKIE = () => (isProduction() ? "__Host-paytrace_session" : "paytrace_session");

const ttlMs = () => env().SESSION_TTL_HOURS * 60 * 60 * 1000;

export async function createSession(userId: string, meta: { ip: string | null; userAgent: string | null }) {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + ttlMs());
  await getDb()
    .insert(sessions)
    .values({ id: hashToken(token), userId, expiresAt, ip: meta.ip, userAgent: meta.userAgent?.slice(0, 300) ?? null });
  return { token, expiresAt };
}

/**
 * Validates a session token. Sessions slide: when less than half the lifetime remains, the
 * expiry is pushed forward. Inactive users never validate, so deactivation is immediate.
 */
export async function validateSessionToken(token: string | undefined | null): Promise<ValidSession | null> {
  if (!token || token.length > 100) return null;
  const db = getDb();
  const id = hashToken(token);
  const rows = await db
    .select({
      sessionId: sessions.id,
      expiresAt: sessions.expiresAt,
      userId: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      isActive: users.isActive,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const now = Date.now();
  if (row.expiresAt.getTime() <= now || !row.isActive) {
    await db.delete(sessions).where(eq(sessions.id, id));
    return null;
  }
  let expiresAt = row.expiresAt;
  if (expiresAt.getTime() - now < ttlMs() / 2) {
    expiresAt = new Date(now + ttlMs());
    await db.update(sessions).set({ expiresAt, lastSeenAt: new Date() }).where(eq(sessions.id, id));
  }
  return {
    sessionId: id,
    expiresAt,
    user: { id: row.userId, email: row.email, name: row.name, role: row.role },
  };
}

export async function invalidateSession(sessionId: string) {
  await getDb().delete(sessions).where(eq(sessions.id, sessionId));
}

export async function invalidateUserSessions(userId: string, exceptSessionId?: string) {
  const db = getDb();
  await db.delete(sessions).where(exceptSessionId ? and(eq(sessions.userId, userId), ne(sessions.id, exceptSessionId)) : eq(sessions.userId, userId));
}

export async function purgeExpiredSessions() {
  await getDb().delete(sessions).where(lt(sessions.expiresAt, new Date()));
}

export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax" as const,
    path: "/",
    expires: expiresAt,
  };
}
