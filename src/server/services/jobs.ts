import { sql } from "drizzle-orm";
import { getDb, type Database } from "@/db";
import { jobs } from "@/db/schema";
import type { Tx } from "../audit";

export type JobType = "SIMULATE" | "RECONCILE";

export async function enqueueJob(tx: Tx | Database, type: JobType, id: string) {
  await tx.insert(jobs).values({ type, payload: { id } });
  // Wake idle workers immediately instead of waiting for the next poll.
  await tx.execute(sql`select pg_notify('paytrace_jobs', ${type})`);
}

export interface ClaimedJob {
  id: number;
  type: JobType;
  payload: { id: string };
  attempts: number;
  maxAttempts: number;
}

/** Claims one ready job. SKIP LOCKED lets any number of workers run without double-processing. */
export async function claimJob(workerId: string): Promise<ClaimedJob | null> {
  const rows = await getDb().execute<{ id: string; type: JobType; payload: { id: string }; attempts: number; max_attempts: number }>(sql`
    update jobs set status = 'RUNNING', locked_at = now(), locked_by = ${workerId}, attempts = attempts + 1
    where id = (
      select id from jobs where status = 'QUEUED' and run_after <= now()
      order by id for update skip locked limit 1
    )
    returning id, type, payload, attempts, max_attempts`);
  const row = rows[0];
  if (!row) return null;
  return { id: Number(row.id), type: row.type, payload: row.payload, attempts: row.attempts, maxAttempts: row.max_attempts };
}

export async function completeJob(id: number) {
  await getDb().execute(sql`update jobs set status = 'COMPLETED', finished_at = now(), locked_at = null where id = ${id}`);
}

/** Retries with exponential backoff; returns true when the job has permanently failed. */
export async function failJob(job: ClaimedJob, error: string): Promise<boolean> {
  const final = job.attempts >= job.maxAttempts;
  const delaySeconds = 5 * 2 ** job.attempts;
  await getDb().execute(sql`
    update jobs set
      status = ${final ? "FAILED" : "QUEUED"}::job_status,
      last_error = ${error.slice(0, 2000)},
      locked_at = null,
      run_after = now() + make_interval(secs => ${delaySeconds}),
      finished_at = ${final ? sql`now()` : sql`null`}
    where id = ${job.id}`);
  return final;
}

/** Re-queues jobs whose worker died mid-flight (no heartbeat for 15 minutes). */
export async function recoverStaleJobs() {
  await getDb().execute(sql`
    update jobs set status = 'QUEUED', locked_at = null, locked_by = null
    where status = 'RUNNING' and locked_at < now() - interval '15 minutes'`);
}
