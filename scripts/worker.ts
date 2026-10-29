// Standalone background worker: `npm run worker`. Run one or more alongside the web app.
import { closeDb } from "@/db";
import { logger } from "@/lib/logger";
import { startWorker } from "@/server/worker";

const worker = startWorker();

async function shutdown(signal: string) {
  logger.info({ signal }, "worker shutting down");
  await worker.stop();
  await closeDb();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
