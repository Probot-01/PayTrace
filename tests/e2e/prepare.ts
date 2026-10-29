import { execFileSync } from "node:child_process";
import { cpSync, existsSync } from "node:fs";
import postgres from "postgres";

// Runs before the standalone server starts (see playwright.config.ts webServer.command).

/** Fresh database + demo data, and the static assets the standalone server needs next to it. */
async function prepare() {
  const url = process.env.E2E_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/paytrace_e2e";
  const name = new URL(url).pathname.slice(1);
  if (!/e2e|test/i.test(name)) throw new Error("E2E database name must contain 'e2e' or 'test'.");
  const admin = postgres(url.replace(/\/[^/]*$/, "/postgres"), { max: 1, onnotice: () => {} });
  await admin.unsafe(`drop database if exists "${name}" with (force)`);
  await admin.unsafe(`create database "${name}"`);
  await admin.end();

  const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: url, APP_URL: "http://localhost", NODE_ENV: "development", LOG_LEVEL: "warn" };
  execFileSync("node", ["scripts/migrate.mjs"], { env, stdio: "inherit" });
  execFileSync("npx", ["tsx", "--tsconfig", "tsconfig.json", "scripts/seed-demo.ts"], { env, stdio: "inherit" });

  if (!existsSync(".next/standalone/server.js")) throw new Error("Run `npm run build` before the end-to-end tests.");
  cpSync(".next/static", ".next/standalone/.next/static", { recursive: true });
  if (existsSync("public")) cpSync("public", ".next/standalone/public", { recursive: true });
}

prepare().catch((err) => {
  console.error(err);
  process.exit(1);
});
