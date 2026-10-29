import { and, asc, count, desc, eq, inArray, isNull, lt, sql, sum, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { getDb } from "@/db";
import { exceptionActivity, exceptions, reconRunFiles, reconRuns, sourceFiles, sourceRecords, users } from "@/db/schema";
import { csvCell, toCsvLine, toIstIso } from "@/domain/ingest/csv-format";
import { accruedCompensationPaise, type Compensation } from "@/domain/recon/tat";
import {
  CATEGORY_LABELS,
  EXCEPTION_CATEGORIES,
  EXCEPTION_STATUSES,
  OPEN_EXCEPTION_STATUSES,
  PAYMENT_METHODS,
  RESOLUTION_CODES,
  SEVERITIES,
  SOURCE_SYSTEMS,
  type ExceptionStatus,
  type UserRole,
} from "@/domain/types";
import { conflict, forbidden, notFound, validationFailed } from "@/lib/errors";
import { paiseToPlain } from "@/lib/money";
import { audit, type AuditActor } from "../audit";
import { can, roleAtLeast } from "../auth/permissions";
import { getSettings } from "./settings";

const csvList = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",").filter(Boolean) : []))
    .pipe(z.array(z.enum(values)).max(values.length));

export const exceptionFilterSchema = z.object({
  runId: z.uuid().optional(),
  status: csvList(EXCEPTION_STATUSES),
  category: csvList(EXCEPTION_CATEGORIES),
  method: csvList(PAYMENT_METHODS),
  severity: csvList(SEVERITIES),
  failurePoint: z.enum(SOURCE_SYSTEMS).optional(),
  manual: z.enum(["yes", "no"]).optional(),
  breached: z.enum(["yes"]).optional(),
  assignee: z.union([z.literal("me"), z.literal("unassigned"), z.uuid()]).optional(),
  q: z.string().trim().max(40).optional(),
  sort: z.enum(["newest", "oldest", "amount", "due", "severity"]).default("severity"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(10).max(100).default(25),
});
export type ExceptionFilter = z.infer<typeof exceptionFilterSchema>;

const severityRank = sql`case ${exceptions.severity} when 'CRITICAL' then 4 when 'HIGH' then 3 when 'MEDIUM' then 2 else 1 end`;

function whereFor(f: ExceptionFilter, userId: string): SQL | undefined {
  const c: SQL[] = [];
  if (f.runId) c.push(eq(exceptions.runId, f.runId));
  if (f.status.length) c.push(inArray(exceptions.status, f.status));
  if (f.category.length) c.push(inArray(exceptions.category, f.category));
  if (f.method.length) c.push(inArray(exceptions.method, f.method));
  if (f.severity.length) c.push(inArray(exceptions.severity, f.severity));
  if (f.failurePoint) c.push(eq(exceptions.failurePoint, f.failurePoint));
  if (f.manual) c.push(eq(exceptions.requiresManual, f.manual === "yes"));
  if (f.breached) {
    c.push(lt(exceptions.tatDueAt, sql`now()`));
    c.push(inArray(exceptions.status, OPEN_EXCEPTION_STATUSES));
  }
  if (f.assignee === "me") c.push(eq(exceptions.assigneeId, userId));
  else if (f.assignee === "unassigned") c.push(isNull(exceptions.assigneeId));
  else if (f.assignee) c.push(eq(exceptions.assigneeId, f.assignee));
  if (f.q) c.push(sql`${exceptions.txnRef} ilike ${f.q.replace(/[%_\\]/g, "\\$&") + "%"}`);
  return c.length ? and(...c) : undefined;
}

function orderFor(sort: ExceptionFilter["sort"]) {
  switch (sort) {
    case "newest":
      return [desc(exceptions.txnAt), asc(exceptions.id)];
    case "oldest":
      return [asc(exceptions.txnAt), asc(exceptions.id)];
    case "amount":
      return [desc(exceptions.affectedPaise), asc(exceptions.id)];
    case "due":
      return [asc(exceptions.tatDueAt), asc(exceptions.id)];
    default:
      return [desc(severityRank), desc(exceptions.affectedPaise), asc(exceptions.id)];
  }
}

const assignee = alias(users, "assignee");

export async function listExceptions(f: ExceptionFilter, userId: string) {
  const db = getDb();
  const where = whereFor(f, userId);
  const [rows, [totals]] = await Promise.all([
    db
      .select({
        id: exceptions.id,
        txnRef: exceptions.txnRef,
        category: exceptions.category,
        severity: exceptions.severity,
        status: exceptions.status,
        method: exceptions.method,
        amountPaise: exceptions.amountPaise,
        affectedPaise: exceptions.affectedPaise,
        failurePoint: exceptions.failurePoint,
        requiresManual: exceptions.requiresManual,
        txnAt: exceptions.txnAt,
        tatDueAt: exceptions.tatDueAt,
        tatBasis: exceptions.tatBasis,
        runId: exceptions.runId,
        assigneeName: assignee.name,
      })
      .from(exceptions)
      .leftJoin(assignee, eq(assignee.id, exceptions.assigneeId))
      .where(where)
      .orderBy(...orderFor(f.sort))
      .limit(f.pageSize)
      .offset((f.page - 1) * f.pageSize),
    db
      .select({ total: count(), affected: sum(exceptions.affectedPaise).mapWith(Number) })
      .from(exceptions)
      .where(where),
  ]);
  return { rows, total: totals.total, affectedPaise: totals.affected ?? 0 };
}

const EXPORT_LIMIT = 100_000;

export async function* exportExceptionsCsv(f: ExceptionFilter, userId: string): AsyncGenerator<string> {
  yield toCsvLine([
    "exception_id",
    "txn_ref",
    "category",
    "severity",
    "status",
    "payment_method",
    "amount_inr",
    "affected_inr",
    "failure_point",
    "requires_manual",
    "txn_at",
    "tat_due_at",
    "tat_basis",
    "suspected_cause",
    "recommended_action",
    "assignee",
    "run_id",
  ]);
  const db = getDb();
  const where = whereFor(f, userId);
  const page = 5_000;
  for (let offset = 0; offset < EXPORT_LIMIT; offset += page) {
    const rows = await db
      .select({ e: exceptions, assigneeName: assignee.name })
      .from(exceptions)
      .leftJoin(assignee, eq(assignee.id, exceptions.assigneeId))
      .where(where)
      .orderBy(...orderFor(f.sort))
      .limit(page)
      .offset(offset);
    if (!rows.length) return;
    let chunk = "";
    for (const { e, assigneeName } of rows) {
      chunk +=
        [
          e.id,
          e.txnRef,
          CATEGORY_LABELS[e.category],
          e.severity,
          e.status,
          e.method,
          paiseToPlain(e.amountPaise),
          paiseToPlain(e.affectedPaise),
          e.failurePoint ?? "",
          e.requiresManual ? "yes" : "no",
          toIstIso(e.txnAt),
          toIstIso(e.tatDueAt),
          e.tatBasis,
          e.suspectedCause,
          e.recommendedAction,
          assigneeName ?? "",
          e.runId,
        ]
          .map(csvCell)
          .join(",") + "\r\n";
    }
    yield chunk;
    if (rows.length < page) return;
  }
}

export async function getException(id: string) {
  const db = getDb();
  const proposer = alias(users, "proposer");
  const resolver = alias(users, "resolver");
  const [row] = await db
    .select({
      e: exceptions,
      assigneeName: assignee.name,
      proposedByName: proposer.name,
      resolvedByName: resolver.name,
      runDate: reconRuns.businessDate,
    })
    .from(exceptions)
    .leftJoin(assignee, eq(assignee.id, exceptions.assigneeId))
    .leftJoin(proposer, eq(proposer.id, exceptions.proposedBy))
    .leftJoin(resolver, eq(resolver.id, exceptions.resolvedBy))
    .innerJoin(reconRuns, eq(reconRuns.id, exceptions.runId))
    .where(eq(exceptions.id, id))
    .limit(1);
  if (!row) throw notFound("Exception");

  const [activity, records, settings] = await Promise.all([
    db
      .select({ a: exceptionActivity, actorName: users.name })
      .from(exceptionActivity)
      .leftJoin(users, eq(users.id, exceptionActivity.actorId))
      .where(eq(exceptionActivity.exceptionId, id))
      .orderBy(asc(exceptionActivity.createdAt), asc(exceptionActivity.id)),
    db
      .select({ r: sourceRecords, filename: sourceFiles.filename })
      .from(sourceRecords)
      .innerJoin(sourceFiles, eq(sourceFiles.id, sourceRecords.fileId))
      .innerJoin(reconRunFiles, and(eq(reconRunFiles.fileId, sourceFiles.id), eq(reconRunFiles.runId, row.e.runId)))
      .where(sql`${sourceRecords.txnRef} = ${row.e.txnRef} or ${sourceRecords.parentRef} = ${row.e.txnRef}`)
      .orderBy(asc(sourceRecords.eventAt))
      .limit(100),
    getSettings(),
  ]);

  const isOpen = OPEN_EXCEPTION_STATUSES.includes(row.e.status);
  const asOf = isOpen ? new Date() : (row.e.resolvedAt ?? new Date());
  const compensationPaise = accruedCompensationPaise(
    { dueAt: row.e.tatDueAt, compensation: row.e.compensation as Compensation },
    row.e.affectedPaise || row.e.amountPaise,
    asOf,
    settings.repoRateBps,
  );

  return {
    ...row.e,
    assigneeName: row.assigneeName,
    proposedByName: row.proposedByName,
    resolvedByName: row.resolvedByName,
    runDate: row.runDate,
    compensationPaise,
    approvalThresholdPaise: settings.approvalThresholdPaise,
    activity: activity.map((x) => ({ ...x.a, actorName: x.actorName })),
    records: records.map((x) => ({ ...x.r, filename: x.filename })),
  };
}

// ---- Workflow -----------------------------------------------------------------------------------

export const assignSchema = z.object({ assigneeId: z.uuid().nullable(), version: z.number().int().min(1) });
export const commentSchema = z.object({ body: z.string().trim().min(1, "Write a comment.").max(2_000) });
export const transitionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start_review"), version: z.number().int().min(1) }),
  z.object({
    action: z.literal("resolve"),
    version: z.number().int().min(1),
    resolutionCode: z.enum(RESOLUTION_CODES, { error: "Choose a resolution." }),
    note: z.string().trim().min(5, "Explain the resolution (at least 5 characters).").max(2_000),
  }),
  z.object({
    action: z.literal("dismiss"),
    version: z.number().int().min(1),
    note: z.string().trim().min(5, "Explain why this is not a real break.").max(2_000),
  }),
  z.object({ action: z.literal("approve"), version: z.number().int().min(1), note: z.string().trim().max(2_000).optional() }),
  z.object({
    action: z.literal("reject"),
    version: z.number().int().min(1),
    note: z.string().trim().min(5, "Tell the analyst what is missing.").max(2_000),
  }),
  z.object({
    action: z.literal("reopen"),
    version: z.number().int().min(1),
    note: z.string().trim().min(5, "Explain why it is being reopened.").max(2_000),
  }),
]);
export type TransitionInput = z.infer<typeof transitionSchema>;

type Actor = AuditActor & { id: string; role: UserRole };

const ALLOWED_FROM: Record<TransitionInput["action"], ExceptionStatus[]> = {
  start_review: ["OPEN"],
  resolve: ["OPEN", "IN_REVIEW"],
  dismiss: ["OPEN", "IN_REVIEW"],
  approve: ["PENDING_APPROVAL"],
  reject: ["PENDING_APPROVAL"],
  reopen: ["RESOLVED", "DISMISSED"],
};

async function loadForUpdate(id: string) {
  const [e] = await getDb().select().from(exceptions).where(eq(exceptions.id, id)).limit(1);
  if (!e) throw notFound("Exception");
  return e;
}

const STALE = () => conflict("Someone else updated this exception. Reload to see the latest version.");

/**
 * Moves an exception through its lifecycle with maker-checker control: a resolution or dismissal
 * affecting at least the approval threshold, proposed by someone below supervisor, waits for a
 * different supervisor's approval. Optimistic locking (version) prevents lost updates.
 */
export async function transitionException(actor: Actor, id: string, input: TransitionInput) {
  if (!can(actor.role, "exceptions:work")) throw forbidden();
  const e = await loadForUpdate(id);
  if (e.version !== input.version) throw STALE();
  if (!ALLOWED_FROM[input.action].includes(e.status)) {
    throw conflict(`This exception is ${e.status.replace("_", " ").toLowerCase()}; that action is not available.`);
  }
  const settings = await getSettings();
  const now = new Date();
  let set: Partial<typeof exceptions.$inferInsert> = {};
  let to: ExceptionStatus;
  let message: string;

  switch (input.action) {
    case "start_review":
      to = "IN_REVIEW";
      set = { assigneeId: e.assigneeId ?? actor.id };
      message = "Started review";
      break;
    case "resolve":
    case "dismiss": {
      const needsApproval = e.affectedPaise >= settings.approvalThresholdPaise && !roleAtLeast(actor.role, "supervisor");
      const resolutionCode = input.action === "resolve" ? input.resolutionCode : null;
      if (needsApproval) {
        to = "PENDING_APPROVAL";
        set = { proposedBy: actor.id, resolutionCode, resolutionNote: input.note };
        message = `${input.action === "resolve" ? "Proposed resolution" : "Proposed dismissal"} (needs supervisor approval): ${input.note}`;
      } else {
        to = input.action === "resolve" ? "RESOLVED" : "DISMISSED";
        set = { proposedBy: actor.id, resolutionCode, resolutionNote: input.note, resolvedBy: actor.id, resolvedAt: now };
        message = `${input.action === "resolve" ? "Resolved" : "Dismissed"}: ${input.note}`;
      }
      break;
    }
    case "approve":
      if (!can(actor.role, "exceptions:approve")) throw forbidden("Only a supervisor can approve resolutions.");
      if (e.proposedBy === actor.id) throw forbidden("A different person must approve your own proposal (four-eyes rule).");
      // A pending proposal with no resolution code is a dismissal.
      to = e.resolutionCode ? "RESOLVED" : "DISMISSED";
      set = { resolvedBy: actor.id, resolvedAt: now };
      message = `Approved${input.note ? `: ${input.note}` : ""}`;
      break;
    case "reject":
      if (!can(actor.role, "exceptions:approve")) throw forbidden("Only a supervisor can reject resolutions.");
      to = "IN_REVIEW";
      set = { resolutionCode: null, resolutionNote: null };
      message = `Sent back: ${input.note}`;
      break;
    case "reopen":
      if (!can(actor.role, "exceptions:approve")) throw forbidden("Only a supervisor can reopen exceptions.");
      to = "IN_REVIEW";
      set = { resolvedBy: null, resolvedAt: null, resolutionCode: null, resolutionNote: null };
      message = `Reopened: ${input.note}`;
      break;
  }

  return getDb().transaction(async (tx) => {
    const [updated] = await tx
      .update(exceptions)
      .set({ ...set, status: to, version: e.version + 1, updatedAt: now })
      .where(and(eq(exceptions.id, id), eq(exceptions.version, input.version)))
      .returning();
    if (!updated) throw STALE();
    await tx
      .insert(exceptionActivity)
      .values({ exceptionId: id, actorId: actor.id, kind: "STATUS", body: message, fromStatus: e.status, toStatus: to });
    await audit(actor, `exception.${input.action}`, "exception", id, { from: e.status, to, txnRef: e.txnRef }, tx);
    return updated;
  });
}

export async function assignException(actor: Actor, id: string, input: z.infer<typeof assignSchema>) {
  if (!can(actor.role, "exceptions:work")) throw forbidden();
  const e = await loadForUpdate(id);
  if (e.version !== input.version) throw STALE();
  if (!OPEN_EXCEPTION_STATUSES.includes(e.status)) throw conflict("Closed exceptions cannot be reassigned. Reopen it first.");
  let name = "nobody";
  if (input.assigneeId) {
    const [u] = await getDb().select().from(users).where(eq(users.id, input.assigneeId)).limit(1);
    if (!u || !u.isActive || u.role === "viewer")
      throw validationFailed({ fieldErrors: { assigneeId: ["Choose an active analyst, supervisor or admin."] } });
    name = u.name;
  }
  return getDb().transaction(async (tx) => {
    const [updated] = await tx
      .update(exceptions)
      .set({ assigneeId: input.assigneeId, version: e.version + 1, updatedAt: new Date() })
      .where(and(eq(exceptions.id, id), eq(exceptions.version, input.version)))
      .returning();
    if (!updated) throw STALE();
    await tx.insert(exceptionActivity).values({ exceptionId: id, actorId: actor.id, kind: "ASSIGNMENT", body: `Assigned to ${name}` });
    await audit(actor, "exception.assign", "exception", id, { assigneeId: input.assigneeId }, tx);
    return updated;
  });
}

export async function commentOnException(actor: Actor, id: string, input: z.infer<typeof commentSchema>) {
  if (!can(actor.role, "exceptions:work")) throw forbidden();
  await loadForUpdate(id);
  const [row] = await getDb().insert(exceptionActivity).values({ exceptionId: id, actorId: actor.id, kind: "COMMENT", body: input.body }).returning();
  await audit(actor, "exception.comment", "exception", id, {});
  return row;
}
