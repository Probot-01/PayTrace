// Integration tests run against a real, disposable PostgreSQL database (never the app's own).
// Import this module first in every integration test file.
import path from "node:path";
import { NextRequest } from "next/server";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/paytrace_test";
if (!/test/i.test(new URL(url).pathname)) throw new Error("Refusing to run integration tests against a database whose name does not contain 'test'.");
process.env.DATABASE_URL = url;
process.env.APP_URL = "http://localhost:3000";
process.env.LOG_LEVEL = "silent";
process.env.TRUSTED_PROXY_HOPS = "0";
process.env.DATABASE_POOL_MAX = "4";
delete process.env.SMTP_URL;

export const APP_ORIGIN = "http://localhost:3000";

let migrated = false;

/** Applies migrations once and empties every table (TRUNCATE bypasses the audit row trigger by design). */
export async function resetDatabase() {
  const client = postgres(url, { max: 1, onnotice: () => {} });
  try {
    if (!migrated) {
      await migrate(drizzle(client), { migrationsFolder: path.resolve(import.meta.dirname, "../../drizzle") });
      migrated = true;
    }
    const tables = await client<{ tablename: string }[]>`select tablename from pg_tables where schemaname = 'public'`;
    if (tables.length) await client.unsafe(`truncate ${tables.map((t) => `"${t.tablename}"`).join(", ")} restart identity cascade`);
  } finally {
    await client.end();
  }
}

export async function createUserWithPassword(email: string, role: "viewer" | "analyst" | "supervisor" | "admin", password = "integration-pass-42") {
  const { getDb } = await import("@/db");
  const { users } = await import("@/db/schema");
  const { hashPassword } = await import("@/server/auth/password");
  const [u] = await getDb()
    .insert(users)
    .values({ email, name: email.split("@")[0], role, passwordHash: await hashPassword(password) })
    .returning();
  return u;
}

export async function sessionCookieFor(userId: string) {
  const { createSession, SESSION_COOKIE } = await import("@/server/auth/session");
  const s = await createSession(userId, { ip: "127.0.0.1", userAgent: "vitest" });
  return `${SESSION_COOKIE()}=${s.token}`;
}

export function apiRequest(
  pathname: string,
  init: { method?: string; json?: unknown; body?: BodyInit; cookie?: string; origin?: string | null; headers?: Record<string, string> } = {},
) {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set("cookie", init.cookie);
  if (init.origin !== null) headers.set("origin", init.origin ?? APP_ORIGIN);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(init.json);
  }
  return new NextRequest(new URL(pathname, APP_ORIGIN), { method: init.method ?? (body ? "POST" : "GET"), headers, body });
}

export const params = (p: Record<string, string>) => ({ params: Promise.resolve(p) });
