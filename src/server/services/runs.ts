import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, withTransaction } from "@/db";
import { copyRows, type CopyValue } from "@/db/copy";
import { exceptions, reconRunFiles, reconRuns, reconTransactions, sourceFiles, sourceRecords, users } from "@/db/schema";
import { reconcile, type ReconStats, type TxnResult } from "@/domain/recon/engine";
import { tatFor } from "@/domain/recon/tat";
import type { NormalizedRecord } from "@/domain/types";
import { badRequest, conflict, notFound } from "@/lib/errors";
import { audit, type AuditActor } from "../audit";
import { enqueueJob } from "./jobs";
import { getSettings, toReconConfig } from "./settings";

export const createRunSchema = z.object({
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the business date as YYYY-MM-DD."),
  fileIds: z.array(z.uuid()).min(2, "Select files from at least two participants.").max(20),
});

export async function createRun(actor: AuditActor, input: z.infer<typeof createRunSchema>) {
  const db = getDb();
  const ids = [...new Set(input.fileIds)];
  const files = await db.select().from(sourceFiles).where(inArray(sourceFiles.id, ids));
  if (files.length !== ids.length) throw badRequest("One or more selected files no longer exist.");
  if (new Set(files.map((f) => f.source)).size < 2) throw badRequest("Select files from at least two different participants.");
  const settings = await getSettings();
  return db.transaction(async (tx) => {
    const [run] = await tx
      .insert(reconRuns)
      .values({ businessDate: input.businessDate, createdBy: actor.id, configSnapshot: settings })
      .returning();
    await tx.insert(reconRunFiles).values(ids.map((fileId) => ({ runId: run.id, fileId })));
    await enqueueJob(tx, "RECONCILE", run.id);
    await audit(actor, "run.create", "recon_run", run.id, { businessDate: input.businessDate, files: ids.length }, tx);
    return run;
  });
}

const CHUNK = 2_000;

const RECON_TXN_COLUMNS = (runId: string) =>
  [
    ["run_id", () => runId],
    ["txn_ref", (t) => t.txnRef],
    ["method", (t) => t.method],
    ["amount_paise", (t) => t.amountPaise],
    ["outcome", (t) => t.outcome],
    ["matched", (t) => t.matched],
    ["is_refund", (t) => t.isRefund],
    ["sources_present", (t) => t.sourcesPresent],
    ["exception_count", (t) => t.exceptionCount],
    ["txn_at", (t) => t.txnAt],
    ["customer_id", (t) => t.customerId],
    ["merchant_id", (t) => t.merchantId],
  ] as const satisfies readonly (readonly [string, (t: TxnResult) => CopyValue])[];

/** Worker step: load the run's records, reconcile, and persist results atomically. */
export async function executeRun(runId: string) {
  const db = getDb();
  const [run] = await db.select().from(reconRuns).where(eq(reconRuns.id, runId)).limit(1);
  if (!run) throw new Error(`run ${runId} not found`);
  if (run.status === "COMPLETED") return;
  await db.update(reconRuns).set({ status: "RUNNING", startedAt: new Date(), error: null }).where(eq(reconRuns.id, runId));

  const settings = { ...(await getSettings()), ...((run.configSnapshot as object | null) ?? {}) };
  const fileIds = (await db.select({ id: reconRunFiles.fileId }).from(reconRunFiles).where(eq(reconRunFiles.runId, runId))).map((r) => r.id);
  const rows = await db
    .select({
      id: sourceRecords.id,
      source: sourceRecords.source,
      txnRef: sourceRecords.txnRef,
      parentRef: sourceRecords.parentRef,
      recordType: sourceRecords.recordType,
      method: sourceRecords.method,
      amountPaise: sourceRecords.amountPaise,
      status: sourceRecords.status,
      customerId: sourceRecords.customerId,
      merchantId: sourceRecords.merchantId,
      issuingBank: sourceRecords.issuingBank,
      acquiringBank: sourceRecords.acquiringBank,
      eventAt: sourceRecords.eventAt,
    })
    .from(sourceRecords)
    .where(inArray(sourceRecords.fileId, fileIds))
    .orderBy(sourceRecords.id);

  const result = reconcile(rows as NormalizedRecord[], toReconConfig(settings as Parameters<typeof toReconConfig>[0]));

  await withTransaction(async ({ sql, db: tx }) => {
    // Idempotent on retry: clear partial output from an earlier attempt.
    await tx.delete(exceptions).where(eq(exceptions.runId, runId));
    await tx.delete(reconTransactions).where(eq(reconTransactions.runId, runId));
    await copyRows(sql, "recon_transactions", RECON_TXN_COLUMNS(runId), result.transactions);
    for (let i = 0; i < result.exceptions.length; i += CHUNK) {
      await tx.insert(exceptions).values(
        result.exceptions.slice(i, i + CHUNK).map((e) => {
          const tat = tatFor(e.category, e.method, e.txnAt);
          return {
            runId,
            txnRef: e.txnRef,
            category: e.category,
            severity: e.severity,
            method: e.method,
            amountPaise: e.amountPaise,
            affectedPaise: e.affectedPaise,
            failurePoint: e.failurePoint,
            suspectedCause: e.suspectedCause,
            recommendedAction: e.recommendedAction,
            requiresManual: e.requiresManual,
            evidence: e.evidence,
            txnAt: e.txnAt,
            tatDueAt: tat.dueAt,
            tatBasis: tat.basis,
            tatDescription: tat.description,
            compensation: tat.compensation,
          };
        }),
      );
    }
    await tx
      .update(reconRuns)
      .set({
        status: "COMPLETED",
        stats: result.stats,
        totalTransactions: result.stats.totalTransactions,
        matchedTransactions: result.stats.matched,
        exceptionCount: result.stats.exceptions,
        affectedValuePaise: result.stats.affectedValuePaise,
        finishedAt: new Date(),
      })
      .where(eq(reconRuns.id, runId));
  });
  return result.stats;
}

export async function markRunFailed(runId: string, error: string) {
  await getDb().update(reconRuns).set({ status: "FAILED", error: error.slice(0, 500), finishedAt: new Date() }).where(eq(reconRuns.id, runId));
}

export const runListSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(10).max(100).default(25),
});

export async function listRuns(page = 1, pageSize = 25) {
  const db = getDb();
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: reconRuns.id,
        businessDate: reconRuns.businessDate,
        status: reconRuns.status,
        totalTransactions: reconRuns.totalTransactions,
        matchedTransactions: reconRuns.matchedTransactions,
        exceptionCount: reconRuns.exceptionCount,
        affectedValuePaise: reconRuns.affectedValuePaise,
        createdAt: reconRuns.createdAt,
        finishedAt: reconRuns.finishedAt,
        startedAt: reconRuns.startedAt,
        error: reconRuns.error,
        createdByName: users.name,
      })
      .from(reconRuns)
      .leftJoin(users, eq(users.id, reconRuns.createdBy))
      .orderBy(desc(reconRuns.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: count() }).from(reconRuns),
  ]);
  return { rows, total };
}

export async function getRun(id: string) {
  const db = getDb();
  const [row] = await db
    .select({ run: reconRuns, createdByName: users.name })
    .from(reconRuns)
    .leftJoin(users, eq(users.id, reconRuns.createdBy))
    .where(eq(reconRuns.id, id))
    .limit(1);
  if (!row) throw notFound("Reconciliation run");
  const files = await db
    .select({ id: sourceFiles.id, source: sourceFiles.source, filename: sourceFiles.filename, rowCount: sourceFiles.rowCount, origin: sourceFiles.origin, simulationId: sourceFiles.simulationId, businessDate: sourceFiles.businessDate })
    .from(reconRunFiles)
    .innerJoin(sourceFiles, eq(sourceFiles.id, reconRunFiles.fileId))
    .where(eq(reconRunFiles.runId, id))
    .orderBy(sourceFiles.source);
  return { ...row.run, stats: row.run.stats as ReconStats | null, createdByName: row.createdByName, files };
}

export async function deleteRun(actor: AuditActor, id: string) {
  const run = await getRun(id);
  if (run.status === "RUNNING" || run.status === "QUEUED") throw conflict("Wait for the run to finish before deleting it.");
  await getDb().transaction(async (tx) => {
    await tx.delete(reconRuns).where(eq(reconRuns.id, id));
    await audit(actor, "run.delete", "recon_run", id, { businessDate: run.businessDate, exceptions: run.exceptionCount }, tx);
  });
}

export const txnListSchema = z.object({
  runId: z.uuid().optional(),
  q: z.string().trim().max(40).optional(),
  outcome: z.enum(["SUCCESS", "FAILED", "PENDING"]).optional(),
  matched: z.enum(["yes", "no"]).optional(),
  method: z.enum(["UPI", "DEBIT_CARD", "CREDIT_CARD", "NEFT", "RTGS"]).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(10).max(100).default(50),
});

export async function listReconTransactions(f: z.infer<typeof txnListSchema>) {
  const db = getDb();
  const conds = [];
  if (f.runId) conds.push(eq(reconTransactions.runId, f.runId));
  if (f.q) conds.push(sql`${reconTransactions.txnRef} ilike ${f.q.replace(/[%_\\]/g, "\\$&") + "%"}`);
  if (f.outcome) conds.push(eq(reconTransactions.outcome, f.outcome));
  if (f.matched) conds.push(eq(reconTransactions.matched, f.matched === "yes"));
  if (f.method) conds.push(eq(reconTransactions.method, f.method));
  const where = conds.length ? and(...conds) : undefined;
  const [rows, [{ total }]] = await Promise.all([
    db.select().from(reconTransactions).where(where).orderBy(desc(reconTransactions.txnAt)).limit(f.pageSize).offset((f.page - 1) * f.pageSize),
    db.select({ total: count() }).from(reconTransactions).where(where),
  ]);
  return { rows, total };
}

/** Everything known about one reference: every participant record and every run's verdict. */
export async function traceTransaction(txnRef: string) {
  const db = getDb();
  const [records, results, excs] = await Promise.all([
    db
      .select({ record: sourceRecords, filename: sourceFiles.filename, businessDate: sourceFiles.businessDate })
      .from(sourceRecords)
      .innerJoin(sourceFiles, eq(sourceFiles.id, sourceRecords.fileId))
      .where(sql`${sourceRecords.txnRef} = ${txnRef} or ${sourceRecords.parentRef} = ${txnRef}`)
      .orderBy(sourceRecords.eventAt)
      .limit(200),
    db.select().from(reconTransactions).where(eq(reconTransactions.txnRef, txnRef)).orderBy(desc(reconTransactions.id)).limit(20),
    db
      .select({ id: exceptions.id, category: exceptions.category, status: exceptions.status, severity: exceptions.severity, runId: exceptions.runId, createdAt: exceptions.createdAt })
      .from(exceptions)
      .where(eq(exceptions.txnRef, txnRef))
      .orderBy(desc(exceptions.createdAt))
      .limit(50),
  ]);
  return { records, results, exceptions: excs };
}
