import { createHash } from "node:crypto";
import { count, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb, withTransaction } from "@/db";
import { copyRows, type CopyValue } from "@/db/copy";
import { exceptions, reconRunFiles, reconRuns, simTransactions, simulations, sourceFiles } from "@/db/schema";
import { CSV_HEADER_LINE, recordToCsvLine } from "@/domain/ingest/csv-format";
import {
  EXPECTED_CATEGORY,
  simulate,
  simulationConfigSchema,
  type InjectedFault,
  type SimTransaction,
  type SimulationConfig,
} from "@/domain/simulator/simulate";
import { SOURCE_SYSTEMS, type ExceptionCategory, type NormalizedRecord } from "@/domain/types";
import { conflict, notFound } from "@/lib/errors";
import { audit, type AuditActor } from "../audit";
import { insertRecords } from "./files";
import { enqueueJob } from "./jobs";

export const createSimulationSchema = z.object({
  name: z.string().trim().min(3, "Give the simulation a name.").max(80),
  config: simulationConfigSchema,
});

export async function createSimulation(actor: AuditActor, input: z.infer<typeof createSimulationSchema>) {
  return getDb().transaction(async (tx) => {
    const [sim] = await tx
      .insert(simulations)
      .values({ name: input.name, businessDate: input.config.businessDate, config: input.config, createdBy: actor.id })
      .returning();
    await enqueueJob(tx, "SIMULATE", sim.id);
    await audit(
      actor,
      "simulation.create",
      "simulation",
      sim.id,
      { name: input.name, count: input.config.transactionCount, seed: input.config.seed },
      tx,
    );
    return sim;
  });
}

const SIM_TXN_COLUMNS = (simulationId: string) =>
  [
    ["simulation_id", () => simulationId],
    ["txn_ref", (t) => t.txnRef],
    ["parent_ref", (t) => t.parentRef],
    ["kind", (t) => t.kind],
    ["customer_id", (t) => t.customerId],
    ["merchant_id", (t) => t.merchantId],
    ["amount_paise", (t) => t.amountPaise],
    ["method", (t) => t.method],
    ["initiated_at", (t) => t.initiatedAt],
    ["issuing_bank", (t) => t.issuingBank],
    ["acquiring_bank", (t) => t.acquiringBank],
    ["switch_status", (t) => t.switchStatus],
    ["bank_status", (t) => t.bankStatus],
    ["merchant_status", (t) => t.merchantStatus],
    ["settlement_status", (t) => t.settlementStatus],
    ["refund_status", (t) => t.refundStatus],
    ["injected_fault", (t) => t.injectedFault],
    ["failure_stage", (t) => t.failureStage],
    ["timeline", (t) => t.timeline as unknown as unknown[]],
  ] as const satisfies readonly (readonly [string, (t: SimTransaction) => CopyValue])[];

/** Worker step: generate the dataset and write one participant file per source. Idempotent on retry. */
export async function executeSimulation(id: string) {
  const db = getDb();
  const [sim] = await db.select().from(simulations).where(eq(simulations.id, id)).limit(1);
  if (!sim) throw new Error(`simulation ${id} not found`);
  if (sim.status === "COMPLETED") return;
  await db.update(simulations).set({ status: "RUNNING" }).where(eq(simulations.id, id));

  const config = simulationConfigSchema.parse(sim.config) as SimulationConfig;
  const output = simulate(config);

  await withTransaction(async ({ sql, db: tx }) => {
    await tx.delete(simTransactions).where(eq(simTransactions.simulationId, id));
    await tx.delete(sourceFiles).where(eq(sourceFiles.simulationId, id));
    await copyRows(sql, "sim_transactions", SIM_TXN_COLUMNS(id), output.transactions);

    const bySource = new Map<string, NormalizedRecord[]>();
    for (const r of output.records) {
      const list = bySource.get(r.source) ?? [];
      list.push(r);
      bySource.set(r.source, list);
    }
    for (const source of SOURCE_SYSTEMS) {
      const recs = bySource.get(source) ?? [];
      // Hash and size of the CSV the file would download as, computed in one pass.
      const hash = createHash("sha256").update(`${id}:${source}:`).update(CSV_HEADER_LINE);
      let csvSize = CSV_HEADER_LINE.length;
      for (const r of recs) {
        const line = recordToCsvLine(r);
        hash.update(line);
        csvSize += line.length;
      }
      const [file] = await tx
        .insert(sourceFiles)
        .values({
          source,
          businessDate: config.businessDate,
          origin: "SIMULATOR",
          simulationId: id,
          filename: `${source.toLowerCase()}_${config.businessDate}_${id.slice(0, 8)}.csv`,
          sha256: hash.digest("hex"),
          sizeBytes: csvSize,
          rowCount: recs.length,
          uploadedBy: sim.createdBy,
        })
        .returning();
      await insertRecords(
        sql,
        recs.map((r, i) => ({
          fileId: file.id,
          source,
          lineNo: i + 2,
          txnRef: r.txnRef,
          parentRef: r.parentRef,
          recordType: r.recordType,
          method: r.method,
          amountPaise: r.amountPaise,
          status: r.status,
          rawStatus: r.status,
          customerId: r.customerId,
          merchantId: r.merchantId,
          issuingBank: r.issuingBank,
          acquiringBank: r.acquiringBank,
          eventAt: r.eventAt,
        })),
      );
    }

    await tx
      .update(simulations)
      .set({
        status: "COMPLETED",
        transactionCount: output.transactions.length,
        faultCounts: output.faultCounts as Record<string, number>,
        completedAt: new Date(),
        error: null,
      })
      .where(eq(simulations.id, id));
  });
}

export async function markSimulationFailed(id: string, error: string) {
  await getDb()
    .update(simulations)
    .set({ status: "FAILED", error: error.slice(0, 500) })
    .where(eq(simulations.id, id));
}

export async function listSimulations(limit = 50) {
  return getDb().select().from(simulations).orderBy(desc(simulations.createdAt)).limit(limit);
}

export async function getSimulation(id: string) {
  const db = getDb();
  const [sim] = await db.select().from(simulations).where(eq(simulations.id, id)).limit(1);
  if (!sim) throw notFound("Simulation");
  const files = await db.select().from(sourceFiles).where(eq(sourceFiles.simulationId, id)).orderBy(sourceFiles.source);
  const runs = files.length
    ? await db
        .selectDistinct({
          id: reconRuns.id,
          status: reconRuns.status,
          createdAt: reconRuns.createdAt,
          matched: reconRuns.matchedTransactions,
          total: reconRuns.totalTransactions,
        })
        .from(reconRuns)
        .innerJoin(reconRunFiles, eq(reconRunFiles.runId, reconRuns.id))
        .where(
          inArray(
            reconRunFiles.fileId,
            files.map((f) => f.id),
          ),
        )
        .orderBy(desc(reconRuns.createdAt))
    : [];
  return { sim, files, runs };
}

export interface DetectionAccuracy {
  expectedFaults: number;
  detected: number;
  recall: number;
  exceptionsRaised: number;
  truePositives: number;
  precision: number;
  byFault: { fault: InjectedFault; expected: ExceptionCategory | null; injected: number; detected: number }[];
}

/** Compares a run's exceptions against the faults the simulator injected (ground truth). */
export async function detectionAccuracy(simulationId: string, runId: string): Promise<DetectionAccuracy> {
  const db = getDb();
  const [truth, raised] = await Promise.all([
    db
      .select({ txnRef: simTransactions.txnRef, fault: simTransactions.injectedFault })
      .from(simTransactions)
      .where(eq(simTransactions.simulationId, simulationId)),
    db.select({ txnRef: exceptions.txnRef, category: exceptions.category }).from(exceptions).where(eq(exceptions.runId, runId)),
  ]);
  const raisedByRef = new Map<string, Set<string>>();
  for (const e of raised) {
    const s = raisedByRef.get(e.txnRef) ?? new Set();
    s.add(e.category);
    raisedByRef.set(e.txnRef, s);
  }
  const faultByRef = new Map(truth.map((t) => [t.txnRef, t.fault as InjectedFault]));
  const byFault = new Map<InjectedFault, { injected: number; detected: number }>();
  let expectedFaults = 0;
  let detected = 0;
  for (const t of truth) {
    const fault = t.fault as InjectedFault;
    const expected = EXPECTED_CATEGORY[fault];
    const entry = byFault.get(fault) ?? { injected: 0, detected: 0 };
    entry.injected++;
    if (expected) {
      expectedFaults++;
      if (raisedByRef.get(t.txnRef)?.has(expected)) {
        detected++;
        entry.detected++;
      }
    }
    byFault.set(fault, entry);
  }
  let truePositives = 0;
  for (const e of raised) {
    const fault = faultByRef.get(e.txnRef);
    if (fault && EXPECTED_CATEGORY[fault] === e.category) truePositives++;
  }
  return {
    expectedFaults,
    detected,
    recall: expectedFaults ? detected / expectedFaults : 1,
    exceptionsRaised: raised.length,
    truePositives,
    precision: raised.length ? truePositives / raised.length : 1,
    byFault: [...byFault.entries()]
      .map(([fault, v]) => ({ fault, expected: EXPECTED_CATEGORY[fault], ...v }))
      .sort((a, b) => b.injected - a.injected),
  };
}

export async function getSimTransaction(txnRef: string) {
  const rows = await getDb()
    .select({ tx: simTransactions, simName: simulations.name })
    .from(simTransactions)
    .innerJoin(simulations, eq(simulations.id, simTransactions.simulationId))
    .where(eq(simTransactions.txnRef, txnRef))
    .orderBy(desc(simulations.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

export async function deleteSimulation(actor: AuditActor, id: string) {
  const { sim, runs } = await getSimulation(id);
  if (runs.length) throw conflict(`This simulation's files are used by ${runs.length} reconciliation run(s). Delete those runs first.`);
  await getDb().transaction(async (tx) => {
    await tx.delete(simulations).where(eq(simulations.id, id));
    await audit(actor, "simulation.delete", "simulation", id, { name: sim.name }, tx);
  });
}

export async function simulationCount() {
  const [{ n }] = await getDb().select({ n: count() }).from(simulations);
  return n;
}
