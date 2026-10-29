import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type postgres from "postgres";

/**
 * Bulk loads rows with COPY ... FROM STDIN (text format). Roughly an order of magnitude faster
 * than multi-row INSERTs for the 100k+ row files reconciliation deals with.
 */
export type CopyValue = string | number | boolean | Date | null | undefined | string[] | Record<string, unknown> | unknown[];

function encode(value: CopyValue): string {
  if (value === null || value === undefined) return "\\N";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "boolean") return value ? "t" : "f";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("COPY: non-finite number");
    return String(value);
  }
  if (typeof value === "string") return escapeText(value);
  if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
    // text[] literal: {"a","b"} with quotes and backslashes escaped inside elements.
    return escapeText(`{${(value as string[]).map((v) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`);
  }
  return escapeText(JSON.stringify(value));
}

function escapeText(s: string): string {
  return s.replace(/[\\\t\n\r]/g, (c) => (c === "\\" ? "\\\\" : c === "\t" ? "\\t" : c === "\n" ? "\\n" : "\\r"));
}

export async function copyRows<T>(
  sql: postgres.Sql | postgres.TransactionSql,
  table: string,
  columns: readonly (readonly [column: string, get: (row: T) => CopyValue])[],
  rows: readonly T[],
): Promise<void> {
  if (rows.length === 0) return;
  const BATCH = 1_000;
  function* lines() {
    for (let i = 0; i < rows.length; i += BATCH) {
      let chunk = "";
      for (const row of rows.slice(i, i + BATCH)) chunk += columns.map(([, get]) => encode(get(row))).join("\t") + "\n";
      yield chunk;
    }
  }
  const writable = await sql`copy ${sql(table)} (${sql(columns.map(([c]) => c))}) from stdin`.writable();
  await pipeline(Readable.from(lines()), writable);
}
