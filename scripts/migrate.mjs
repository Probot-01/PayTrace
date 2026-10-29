// Applies pending SQL migrations from ./drizzle. Safe to run on every deploy (idempotent and
// serialised by drizzle's migrations table + a Postgres advisory lock).
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import path from "node:path";
import { fileURLToPath } from "node:url";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const client = postgres(url, { max: 1, onnotice: () => {} });
try {
  await client`select pg_advisory_lock(7262001)`;
  await migrate(drizzle(client), { migrationsFolder: path.join(here, "..", "drizzle") });
  console.log(JSON.stringify({ level: "info", msg: "migrations applied" }));
} catch (err) {
  console.error(JSON.stringify({ level: "error", msg: "migration failed", error: String(err) }));
  process.exitCode = 1;
} finally {
  await client`select pg_advisory_unlock(7262001)`.catch(() => {});
  await client.end();
}
