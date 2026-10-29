import { hostname } from "node:os";
import { getSqlClient } from "@/db";
import { logger } from "@/lib/logger";
import { purgeExpiredSessions } from "./auth/session";
import { claimJob, completeJob, failJob, recoverStaleJobs, type ClaimedJob } from "./services/jobs";
import { executeRun, markRunFailed } from "./services/runs";
import { executeSimulation, markSimulationFailed } from "./services/simulations";

const POLL_MS = 2_000;
const MAINTENANCE_MS = 5 * 60_000;

async function handle(job: ClaimedJob) {
  if (job.type === "SIMULATE") await executeSimulation(job.payload.id);
  else if (job.type === "RECONCILE") await executeRun(job.payload.id);
}

async function onPermanentFailure(job: ClaimedJob, message: string) {
  if (job.type === "SIMULATE") await markSimulationFailed(job.payload.id, message);
  else await markRunFailed(job.payload.id, message);
}

/** Processes all ready jobs, then returns. Exported for tests and one-shot use. */
export async function drainJobs(workerId = `${hostname()}:${process.pid}`): Promise<number> {
  let processed = 0;
  for (;;) {
    const job = await claimJob(workerId);
    if (!job) return processed;
    const started = Date.now();
    try {
      await handle(job);
      await completeJob(job.id);
      logger.info({ jobId: job.id, type: job.type, ms: Date.now() - started }, "job completed");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const final = await failJob(job, message);
      logger.error({ jobId: job.id, type: job.type, attempt: job.attempts, final, err: message }, "job failed");
      if (final) await onPermanentFailure(job, "Processing failed. An administrator can see details in the logs.");
    }
    processed++;
  }
}

export interface WorkerHandle {
  stop: () => Promise<void>;
}

export function startWorker(): WorkerHandle {
  const workerId = `${hostname()}:${process.pid}`;
  let stopped = false;
  let running: Promise<unknown> = Promise.resolve();
  let wake: (() => void) | null = null;

  const loop = async () => {
    let lastMaintenance = 0;
    while (!stopped) {
      try {
        if (Date.now() - lastMaintenance > MAINTENANCE_MS) {
          await recoverStaleJobs();
          await purgeExpiredSessions();
          lastMaintenance = Date.now();
        }
        running = drainJobs(workerId);
        await running;
      } catch (err) {
        logger.error({ err: err instanceof Error ? err.message : String(err) }, "worker loop error");
      }
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, POLL_MS);
        wake = () => {
          clearTimeout(t);
          resolve();
        };
      });
      wake = null;
    }
  };

  // LISTEN lets new jobs start immediately; polling remains the fallback.
  const listen = getSqlClient()
    .listen("paytrace_jobs", () => wake?.())
    .catch((err) => {
      logger.warn({ err: String(err) }, "job notifications unavailable; polling only");
      return null;
    });

  const done = loop();
  logger.info({ workerId }, "job worker started");
  return {
    stop: async () => {
      stopped = true;
      wake?.();
      const l = await listen;
      await l?.unlisten().catch(() => {});
      await running.catch(() => {});
      await done;
    },
  };
}
