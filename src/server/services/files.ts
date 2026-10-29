import { createHash } from "node:crypto";
import { and, count, desc, eq, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type postgres from "postgres";
import { getDb, withTransaction } from "@/db";
import { copyRows, type CopyValue } from "@/db/copy";
import { reconRunFiles, sourceFiles, sourceRecords } from "@/db/schema";
import { MAX_UPLOAD_BYTES, parseParticipantCsv, CSV_HEADER_LINE, recordToCsvLine } from "@/domain/ingest/csv-format";
import { SOURCE_SYSTEMS, type SourceSystem } from "@/domain/types";
import { badRequest, conflict, notFound, validationFailed } from "@/lib/errors";
import { audit, type AuditActor } from "../audit";

export const uploadMetaSchema = z.object({
  source: z.enum(SOURCE_SYSTEMS, { error: "Choose which participant this file comes from." }),
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the business date as YYYY-MM-DD."),
});

export type RecordInsert = Omit<typeof sourceRecords.$inferInsert, "id">;

const RECORD_COLUMNS = [
  ["file_id", (r) => r.fileId],
  ["source", (r) => r.source],
  ["line_no", (r) => r.lineNo],
  ["txn_ref", (r) => r.txnRef],
  ["parent_ref", (r) => r.parentRef],
  ["record_type", (r) => r.recordType],
  ["method", (r) => r.method],
  ["amount_paise", (r) => r.amountPaise],
  ["status", (r) => r.status],
  ["raw_status", (r) => r.rawStatus],
  ["customer_id", (r) => r.customerId],
  ["merchant_id", (r) => r.merchantId],
  ["issuing_bank", (r) => r.issuingBank],
  ["acquiring_bank", (r) => r.acquiringBank],
  ["event_at", (r) => r.eventAt],
] as const satisfies readonly (readonly [string, (r: RecordInsert) => CopyValue])[];

/** Bulk-loads participant records inside the caller's transaction. */
export async function insertRecords(sql: postgres.TransactionSql, rows: RecordInsert[]) {
  await copyRows(sql, "source_records", RECORD_COLUMNS, rows);
}

export async function uploadParticipantFile(
  actor: AuditActor,
  meta: z.infer<typeof uploadMetaSchema>,
  file: { name: string; type: string; bytes: Uint8Array },
) {
  if (file.bytes.byteLength === 0) throw badRequest("The file is empty.");
  if (file.bytes.byteLength > MAX_UPLOAD_BYTES) throw badRequest(`The file is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`);
  if (!/\.csv$/i.test(file.name)) throw badRequest("Only .csv files are accepted.");
  if (file.type && !["text/csv", "application/vnd.ms-excel", "text/plain", "application/octet-stream"].includes(file.type)) {
    throw badRequest("Only CSV files are accepted.");
  }
  let content: string;
  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(file.bytes);
  } catch {
    throw badRequest("The file is not valid UTF-8 text.");
  }
  if (content.includes("\u0000")) throw badRequest("The file contains binary data.");

  const sha256 = createHash("sha256").update(file.bytes).digest("hex");
  const db = getDb();
  const dup = await db
    .select({ id: sourceFiles.id, filename: sourceFiles.filename })
    .from(sourceFiles)
    .where(and(eq(sourceFiles.source, meta.source), eq(sourceFiles.sha256, sha256)))
    .limit(1);
  if (dup[0]) throw conflict(`This exact file was already uploaded as "${dup[0].filename}".`, { existingId: dup[0].id });

  const parsed = parseParticipantCsv(content, meta.source);
  if (!parsed.ok) {
    throw validationFailed(
      { rowErrors: parsed.errors, totalErrors: parsed.totalErrors, rowCount: parsed.rowCount },
      `The file was rejected: ${parsed.totalErrors.toLocaleString("en-IN")} problem(s) found. Nothing was imported.`,
    );
  }

  const safeName = file.name.replace(/[^\w.\- ]+/g, "_").slice(0, 120);
  const created = await withTransaction(async ({ sql, db: tx }) => {
    const [row] = await tx
      .insert(sourceFiles)
      .values({
        source: meta.source,
        businessDate: meta.businessDate,
        origin: "UPLOAD",
        filename: safeName,
        sha256,
        sizeBytes: file.bytes.byteLength,
        rowCount: parsed.records.length,
        uploadedBy: actor.id,
      })
      .returning();
    await insertRecords(
      sql,
      parsed.records.map((r) => ({ ...r, fileId: row.id, source: meta.source })),
    );
    await audit(actor, "file.upload", "source_file", row.id, { source: meta.source, rows: row.rowCount, filename: safeName, sha256 }, tx);
    return row;
  });
  return created;
}

export const fileListSchema = z.object({
  source: z.enum(SOURCE_SYSTEMS).optional(),
  businessDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  origin: z.enum(["UPLOAD", "SIMULATOR"]).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(10).max(100).default(25),
});

export async function listFiles(filter: z.infer<typeof fileListSchema>) {
  const db = getDb();
  const conds: SQL[] = [];
  if (filter.source) conds.push(eq(sourceFiles.source, filter.source));
  if (filter.businessDate) conds.push(eq(sourceFiles.businessDate, filter.businessDate));
  if (filter.origin) conds.push(eq(sourceFiles.origin, filter.origin));
  const where = conds.length ? and(...conds) : undefined;
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: sourceFiles.id,
        source: sourceFiles.source,
        businessDate: sourceFiles.businessDate,
        origin: sourceFiles.origin,
        filename: sourceFiles.filename,
        rowCount: sourceFiles.rowCount,
        sizeBytes: sourceFiles.sizeBytes,
        createdAt: sourceFiles.createdAt,
        simulationId: sourceFiles.simulationId,
        runCount: sql<number>`(select count(*)::int from ${reconRunFiles} where ${reconRunFiles.fileId} = ${sourceFiles.id})`,
      })
      .from(sourceFiles)
      .where(where)
      .orderBy(desc(sourceFiles.createdAt))
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize),
    db.select({ total: count() }).from(sourceFiles).where(where),
  ]);
  return { rows, total };
}

export async function getFile(id: string) {
  const [file] = await getDb().select().from(sourceFiles).where(eq(sourceFiles.id, id)).limit(1);
  if (!file) throw notFound("File");
  return file;
}

export async function getFileRecords(id: string, page: number, pageSize = 50) {
  const db = getDb();
  return db
    .select()
    .from(sourceRecords)
    .where(eq(sourceRecords.fileId, id))
    .orderBy(sourceRecords.lineNo, sourceRecords.id)
    .limit(pageSize)
    .offset((page - 1) * pageSize);
}

/** Streams a stored file back out in the canonical CSV format. */
export async function* fileAsCsv(id: string): AsyncGenerator<string> {
  yield CSV_HEADER_LINE;
  const db = getDb();
  let lastId = 0;
  for (;;) {
    const batch = await db
      .select()
      .from(sourceRecords)
      .where(and(eq(sourceRecords.fileId, id), sql`${sourceRecords.id} > ${lastId}`))
      .orderBy(sourceRecords.id)
      .limit(5_000);
    if (!batch.length) return;
    let chunk = "";
    for (const r of batch) chunk += recordToCsvLine(r);
    yield chunk;
    lastId = batch[batch.length - 1].id;
  }
}

export async function deleteFile(actor: AuditActor, id: string) {
  const file = await getFile(id);
  const [{ n }] = await getDb().select({ n: count() }).from(reconRunFiles).where(eq(reconRunFiles.fileId, id));
  if (n > 0) throw conflict(`This file is used by ${n} reconciliation run(s). Delete those runs first so their results stay explainable.`);
  await getDb().transaction(async (tx) => {
    await tx.delete(sourceFiles).where(eq(sourceFiles.id, id));
    await audit(actor, "file.delete", "source_file", id, { filename: file.filename, source: file.source, rows: file.rowCount }, tx);
  });
}

/** The latest file per participant for a business date: the default selection for a new run. */
export async function latestFilesForDate(businessDate: string) {
  const rows = await getDb().select().from(sourceFiles).where(eq(sourceFiles.businessDate, businessDate)).orderBy(desc(sourceFiles.createdAt));
  const picked = new Map<SourceSystem, (typeof rows)[number]>();
  for (const r of rows) if (!picked.has(r.source)) picked.set(r.source, r);
  return [...picked.values()];
}

/** Business dates that have at least one participant file, newest first. */
export async function datesWithFiles(limit = 60) {
  const rows = await getDb()
    .select({ businessDate: sourceFiles.businessDate, files: count(), sources: sql<number>`count(distinct ${sourceFiles.source})::int` })
    .from(sourceFiles)
    .groupBy(sourceFiles.businessDate)
    .orderBy(desc(sourceFiles.businessDate))
    .limit(limit);
  return rows;
}

export async function filesForDate(businessDate: string) {
  return getDb()
    .select({
      id: sourceFiles.id,
      source: sourceFiles.source,
      filename: sourceFiles.filename,
      rowCount: sourceFiles.rowCount,
      origin: sourceFiles.origin,
      createdAt: sourceFiles.createdAt,
    })
    .from(sourceFiles)
    .where(eq(sourceFiles.businessDate, businessDate))
    .orderBy(sourceFiles.source, desc(sourceFiles.createdAt));
}
