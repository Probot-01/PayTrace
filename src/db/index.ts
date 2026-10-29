import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";
import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;

declare global {
  var __paytraceDb: { client: postgres.Sql; db: Database } | undefined;
}

function create() {
  const config = env();
  const client = postgres(config.DATABASE_URL, {
    max: config.DATABASE_POOL_MAX,
    idle_timeout: 30,
    connect_timeout: 10,
    prepare: true,
    onnotice: () => {},
  });
  return { client, db: drizzle(client, { schema, casing: "snake_case" }) };
}

/** A single pool per process (survives hot reloads in development). */
export function getDb(): Database {
  globalThis.__paytraceDb ??= create();
  return globalThis.__paytraceDb.db;
}

export function getSqlClient(): postgres.Sql {
  globalThis.__paytraceDb ??= create();
  return globalThis.__paytraceDb.client;
}

export async function closeDb() {
  if (globalThis.__paytraceDb) {
    await globalThis.__paytraceDb.client.end({ timeout: 5 });
    globalThis.__paytraceDb = undefined;
  }
}

export { schema };

/**
 * Runs `fn` in one transaction, exposing both the raw client (for COPY) and a Drizzle instance
 * bound to the same transaction.
 */
export async function withTransaction<T>(fn: (t: { sql: postgres.TransactionSql; db: Database }) => Promise<T>): Promise<T> {
  const root = getSqlClient();
  const result = await root.begin((sql) => {
    // A transaction handle lacks the root client's `options`, which Drizzle reads for type parsers.
    const bound = Object.assign(sql, { options: root.options }) as unknown as postgres.Sql;
    return fn({ sql, db: drizzle(bound, { schema, casing: "snake_case" }) });
  });
  return result as T;
}
