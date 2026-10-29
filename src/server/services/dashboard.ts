import { and, count, desc, eq, inArray, lt, sql, sum } from "drizzle-orm";
import { getDb } from "@/db";
import { auditEvents, exceptions, reconRuns, users } from "@/db/schema";
import type { ReconStats } from "@/domain/recon/engine";
import { OPEN_EXCEPTION_STATUSES, type ExceptionCategory, type ExceptionStatus, type SourceSystem } from "@/domain/types";
import { getSettings } from "./settings";

export async function completedRunOptions(limit = 60) {
  return getDb()
    .select({ id: reconRuns.id, businessDate: reconRuns.businessDate, createdAt: reconRuns.createdAt, total: reconRuns.totalTransactions })
    .from(reconRuns)
    .where(eq(reconRuns.status, "COMPLETED"))
    .orderBy(desc(reconRuns.createdAt))
    .limit(limit);
}

/**
 * Compensation accrued on still-open exceptions past their TAT, computed in SQL:
 * flat ₹/day for card & UPI rules, pro-rata penal interest (repo + spread) for NEFT/RTGS.
 */
function compensationExpr(repoRateBps: number) {
  return sql<number>`coalesce(sum(
    case
      when ${exceptions.compensation}->>'kind' = 'FLAT_PER_DAY'
        then ceil(extract(epoch from (now() - ${exceptions.tatDueAt})) / 86400.0) * (${exceptions.compensation}->>'paisePerDay')::bigint
      when ${exceptions.compensation}->>'kind' = 'PENAL_INTEREST'
        then round((case when ${exceptions.affectedPaise} > 0 then ${exceptions.affectedPaise} else ${exceptions.amountPaise} end) * ((${repoRateBps} + (${exceptions.compensation}->>'spreadBps')::int) / 10000.0)
             * extract(epoch from (now() - ${exceptions.tatDueAt})) / (365 * 86400.0))
      else 0
    end), 0)::bigint`.mapWith(Number);
}

export async function runDashboard(runId: string) {
  const db = getDb();
  const settings = await getSettings();
  const [run] = await db.select().from(reconRuns).where(eq(reconRuns.id, runId)).limit(1);
  if (!run || run.status !== "COMPLETED") return null;
  const open = and(eq(exceptions.runId, runId), inArray(exceptions.status, OPEN_EXCEPTION_STATUSES));

  const [statusRows, pointRows, [breach], queue] = await Promise.all([
    db.select({ status: exceptions.status, n: count(), affected: sum(exceptions.affectedPaise).mapWith(Number) }).from(exceptions).where(eq(exceptions.runId, runId)).groupBy(exceptions.status),
    db.select({ point: exceptions.failurePoint, n: count() }).from(exceptions).where(eq(exceptions.runId, runId)).groupBy(exceptions.failurePoint),
    db
      .select({ n: count(), compensation: compensationExpr(settings.repoRateBps) })
      .from(exceptions)
      .where(and(open, lt(exceptions.tatDueAt, sql`now()`))),
    db
      .select({
        id: exceptions.id,
        txnRef: exceptions.txnRef,
        category: exceptions.category,
        severity: exceptions.severity,
        status: exceptions.status,
        affectedPaise: exceptions.affectedPaise,
        tatDueAt: exceptions.tatDueAt,
        method: exceptions.method,
      })
      .from(exceptions)
      .where(and(open, eq(exceptions.requiresManual, true)))
      .orderBy(desc(sql`case ${exceptions.severity} when 'CRITICAL' then 4 when 'HIGH' then 3 when 'MEDIUM' then 2 else 1 end`), desc(exceptions.affectedPaise))
      .limit(8),
  ]);

  const byStatus = Object.fromEntries(statusRows.map((r) => [r.status, { count: r.n, affected: r.affected ?? 0 }])) as Partial<
    Record<ExceptionStatus, { count: number; affected: number }>
  >;
  const openCount = OPEN_EXCEPTION_STATUSES.reduce((s, k) => s + (byStatus[k]?.count ?? 0), 0);
  const openAffected = OPEN_EXCEPTION_STATUSES.reduce((s, k) => s + (byStatus[k]?.affected ?? 0), 0);

  return {
    run,
    stats: run.stats as ReconStats,
    byStatus,
    openCount,
    openAffected,
    breachedCount: breach.n,
    compensationPaise: breach.compensation,
    failurePoints: pointRows
      .filter((r) => r.point)
      .map((r) => ({ point: r.point as SourceSystem, count: r.n }))
      .sort((a, b) => b.count - a.count),
    queue,
  };
}

export async function reconTrend(limit = 14) {
  const rows = await getDb()
    .select({
      id: reconRuns.id,
      businessDate: reconRuns.businessDate,
      total: reconRuns.totalTransactions,
      matched: reconRuns.matchedTransactions,
      exceptions: reconRuns.exceptionCount,
      createdAt: reconRuns.createdAt,
    })
    .from(reconRuns)
    .where(eq(reconRuns.status, "COMPLETED"))
    .orderBy(desc(reconRuns.createdAt))
    .limit(limit);
  return rows.reverse().map((r) => ({ ...r, rate: r.total ? r.matched / r.total : 0 }));
}

/** Workload across all runs: what the operations team still owes. */
export async function portfolio(userId: string) {
  const db = getDb();
  const settings = await getSettings();
  const open = inArray(exceptions.status, OPEN_EXCEPTION_STATUSES);
  const [[totals], [breached], [mine], [pendingApproval], categories] = await Promise.all([
    db.select({ n: count(), affected: sum(exceptions.affectedPaise).mapWith(Number) }).from(exceptions).where(open),
    db.select({ n: count(), compensation: compensationExpr(settings.repoRateBps) }).from(exceptions).where(and(open, lt(exceptions.tatDueAt, sql`now()`))),
    db.select({ n: count() }).from(exceptions).where(and(open, eq(exceptions.assigneeId, userId))),
    db.select({ n: count() }).from(exceptions).where(eq(exceptions.status, "PENDING_APPROVAL")),
    db
      .select({ category: exceptions.category, n: count(), affected: sum(exceptions.affectedPaise).mapWith(Number) })
      .from(exceptions)
      .where(open)
      .groupBy(exceptions.category),
  ]);
  return {
    openCount: totals.n,
    openAffected: totals.affected ?? 0,
    breachedCount: breached.n,
    compensationPaise: breached.compensation,
    assignedToMe: mine.n,
    pendingApproval: pendingApproval.n,
    categories: categories.map((c) => ({ category: c.category as ExceptionCategory, count: c.n, affected: c.affected ?? 0 })),
  };
}

export async function listAudit(filter: { action?: string; entityType?: string; page: number; pageSize: number }) {
  const db = getDb();
  const conds = [];
  if (filter.action) conds.push(sql`${auditEvents.action} like ${filter.action.replace(/[%_\\]/g, "\\$&") + "%"}`);
  if (filter.entityType) conds.push(eq(auditEvents.entityType, filter.entityType));
  const where = conds.length ? and(...conds) : undefined;
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({ a: auditEvents, actorName: users.name })
      .from(auditEvents)
      .leftJoin(users, eq(users.id, auditEvents.actorId))
      .where(where)
      .orderBy(desc(auditEvents.id))
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize),
    db.select({ total: count() }).from(auditEvents).where(where),
  ]);
  return { rows: rows.map((r) => ({ ...r.a, actorName: r.actorName })), total };
}
