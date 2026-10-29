import { defineConfig, devices } from "@playwright/test";

// End-to-end tests run against the production build (standalone server) and a disposable database.
const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://localhost:${PORT}`;
const databaseUrl = process.env.E2E_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/paytrace_e2e";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  timeout: 60_000,
  globalSetup: "./tests/e2e/global-setup.ts",
  use: { baseURL, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, dependencies: ["setup"], testIgnore: /auth\.setup\.ts/ },
  ],
  webServer: {
    command: "node .next/standalone/server.js",
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      NODE_ENV: "production",
      PORT: String(PORT),
      HOSTNAME: "127.0.0.1",
      DATABASE_URL: databaseUrl,
      APP_URL: baseURL,
      EMBEDDED_WORKER: "true",
      TRUSTED_PROXY_HOPS: "0",
      LOG_LEVEL: "warn",
    },
  },
});
