import { parse } from "csv-parse/sync";
import { z } from "zod";
import { parseRupeesToPaise, paiseToPlain } from "@/lib/money";
import {
  PAYMENT_METHODS,
  RECORD_TYPES,
  type NormalizedRecord,
  type PaymentMethod,
  type RecordStatus,
  type SourceSystem,
} from "../types";

/**
 * The participant file format. Every participant (switch, issuer, acquirer, merchant, settlement)
 * exchanges the same column layout; raw status codes from different systems are mapped onto the
 * four normalised statuses and the original value is kept for audit.
 */
export const CSV_COLUMNS = [
  "txn_ref",
  "parent_ref",
  "record_type",
  "payment_method",
  "amount",
  "currency",
  "status",
  "customer_id",
  "merchant_id",
  "issuing_bank",
  "acquiring_bank",
  "event_at",
] as const;

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const MAX_ROWS = 250_000;
const MAX_REPORTED_ERRORS = 50;

const STATUS_ALIASES: Record<string, RecordStatus> = {
  SUCCESS: "SUCCESS", S: "SUCCESS", SUCCESSFUL: "SUCCESS", APPROVED: "SUCCESS", CAPTURED: "SUCCESS",
  SETTLED: "SUCCESS", COMPLETED: "SUCCESS", CREDITED: "SUCCESS", DEBITED: "SUCCESS", "00": "SUCCESS", PAID: "SUCCESS",
  FAILED: "FAILED", F: "FAILED", FAILURE: "FAILED", DECLINED: "FAILED", REJECTED: "FAILED", U: "FAILED",
  UNSETTLED: "FAILED", RETURNED: "FAILED", ERROR: "FAILED",
  PENDING: "PENDING", P: "PENDING", DEEMED: "PENDING", TIMEOUT: "PENDING", T: "PENDING", PROCESSING: "PENDING",
  INITIATED: "PENDING", IN_PROGRESS: "PENDING",
  REVERSED: "REVERSED", R: "REVERSED", REFUNDED: "REVERSED",
};

const METHOD_ALIASES: Record<string, PaymentMethod> = {
  UPI: "UPI",
  DEBIT_CARD: "DEBIT_CARD", DEBIT: "DEBIT_CARD", DC: "DEBIT_CARD",
  CREDIT_CARD: "CREDIT_CARD", CREDIT: "CREDIT_CARD", CC: "CREDIT_CARD",
  NEFT: "NEFT",
  RTGS: "RTGS",
};

export function normaliseStatus(raw: string): RecordStatus | null {
  return STATUS_ALIASES[raw.trim().toUpperCase().replace(/[\s-]+/g, "_")] ?? null;
}

/** True when a value looks like a full card number (Luhn-valid, 13–19 digits). We never store PANs. */
export function looksLikeCardNumber(value: string): boolean {
  const digits = value.replace(/[\s-]/g, "");
  if (!/^\d{13,19}$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

const refPattern = /^[A-Za-z0-9_-]{6,40}$/;
const idPattern = /^[A-Za-z0-9_.-]{1,40}$/;
const bankPattern = /^[A-Z]{4}$/;

const optional = (schema: z.ZodString) =>
  z.string().transform((v) => v.trim()).pipe(z.union([z.literal(""), schema])).transform((v) => (v === "" ? null : v));

const rowSchema = z.object({
  txn_ref: z.string().trim().regex(refPattern, "must be 6–40 letters, digits, '-' or '_'"),
  parent_ref: optional(z.string().regex(refPattern, "must be 6–40 letters, digits, '-' or '_'")),
  record_type: z
    .string()
    .trim()
    .transform((v) => (v === "" ? "PAYMENT" : v.toUpperCase()))
    .pipe(z.enum(RECORD_TYPES, { error: `must be one of ${RECORD_TYPES.join(", ")}` })),
  payment_method: z
    .string()
    .transform((v, ctx) => {
      const m = METHOD_ALIASES[v.trim().toUpperCase().replace(/[\s-]+/g, "_")];
      if (!m) {
        ctx.addIssue({ code: "custom", message: `must be one of ${PAYMENT_METHODS.join(", ")}` });
        return z.NEVER;
      }
      return m;
    }),
  amount: z.string().transform((v, ctx) => {
    const paise = parseRupeesToPaise(v);
    if (paise === null || paise <= 0) {
      ctx.addIssue({ code: "custom", message: "must be a positive rupee amount with at most 2 decimals" });
      return z.NEVER;
    }
    return paise;
  }),
  currency: z
    .string()
    .trim()
    .transform((v) => (v === "" ? "INR" : v.toUpperCase()))
    .pipe(z.literal("INR", { error: "only INR is supported" })),
  status: z.string().transform((v, ctx) => {
    const s = normaliseStatus(v);
    if (!s) {
      ctx.addIssue({ code: "custom", message: `unrecognised status '${v.slice(0, 20)}'` });
      return z.NEVER;
    }
    return s;
  }),
  customer_id: optional(z.string().regex(idPattern, "invalid identifier")),
  merchant_id: optional(z.string().regex(idPattern, "invalid identifier")),
  issuing_bank: optional(z.string().regex(bankPattern, "must be a 4-letter IFSC bank code")),
  acquiring_bank: optional(z.string().regex(bankPattern, "must be a 4-letter IFSC bank code")),
  event_at: z.string().transform((v, ctx) => {
    const trimmed = v.trim();
    // Require an explicit offset so timestamps are never interpreted in the server's zone.
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/.test(trimmed)) {
      ctx.addIssue({ code: "custom", message: "must be ISO 8601 with a timezone, e.g. 2026-10-28T14:05:00+05:30" });
      return z.NEVER;
    }
    const d = new Date(trimmed);
    if (Number.isNaN(d.getTime())) {
      ctx.addIssue({ code: "custom", message: "is not a valid date" });
      return z.NEVER;
    }
    return d;
  }),
});

export interface RowError {
  line: number;
  column: string;
  message: string;
}

export type ParseResult =
  | { ok: true; records: (NormalizedRecord & { rawStatus: string; lineNo: number })[] }
  | { ok: false; errors: RowError[]; totalErrors: number; rowCount: number };

export function parseParticipantCsv(content: string, source: SourceSystem): ParseResult {
  let rows: Record<string, string>[];
  try {
    rows = parse(content, {
      columns: (header: string[]) => header.map((h) => h.trim().toLowerCase()),
      skip_empty_lines: true,
      trim: false,
      bom: true,
      relax_column_count: false,
      to: MAX_ROWS + 1,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unreadable CSV";
    return { ok: false, errors: [{ line: 0, column: "file", message: `Malformed CSV: ${message.slice(0, 200)}` }], totalErrors: 1, rowCount: 0 };
  }

  if (rows.length === 0) {
    return { ok: false, errors: [{ line: 1, column: "file", message: "The file has a header but no data rows" }], totalErrors: 1, rowCount: 0 };
  }
  const header = Object.keys(rows[0]);
  const missing = CSV_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length) {
    return {
      ok: false,
      errors: [{ line: 1, column: "header", message: `Missing column(s): ${missing.join(", ")}` }],
      totalErrors: 1,
      rowCount: rows.length,
    };
  }
  if (rows.length > MAX_ROWS) {
    return { ok: false, errors: [{ line: 0, column: "file", message: `Too many rows (limit ${MAX_ROWS.toLocaleString("en-IN")})` }], totalErrors: 1, rowCount: rows.length };
  }

  const errors: RowError[] = [];
  let totalErrors = 0;
  const records: (NormalizedRecord & { rawStatus: string; lineNo: number })[] = [];
  const addError = (e: RowError) => {
    totalErrors++;
    if (errors.length < MAX_REPORTED_ERRORS) errors.push(e);
  };

  rows.forEach((row, index) => {
    const line = index + 2; // 1-based, after the header
    const parsed = rowSchema.safeParse(row);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        addError({ line, column: String(issue.path[0] ?? "row"), message: issue.message });
      }
      return;
    }
    const r = parsed.data;
    for (const col of ["customer_id", "merchant_id"] as const) {
      const v = r[col];
      if (v && looksLikeCardNumber(v)) {
        addError({ line, column: col, message: "looks like a card number; mask or tokenise it before uploading" });
        return;
      }
    }
    if (r.record_type !== "PAYMENT" && !r.parent_ref) {
      addError({ line, column: "parent_ref", message: `is required for ${r.record_type} records` });
      return;
    }
    records.push({
      source,
      txnRef: r.txn_ref,
      parentRef: r.parent_ref,
      recordType: r.record_type,
      method: r.payment_method,
      amountPaise: r.amount,
      status: r.status,
      rawStatus: row.status.trim().slice(0, 32),
      customerId: r.customer_id,
      merchantId: r.merchant_id,
      issuingBank: r.issuing_bank,
      acquiringBank: r.acquiring_bank,
      eventAt: r.event_at,
      lineNo: line,
    });
  });

  if (totalErrors) return { ok: false, errors, totalErrors, rowCount: rows.length };
  return { ok: true, records };
}

/** Escapes a value for CSV output and neutralises spreadsheet formula injection. */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s) && typeof value === "string") s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsvLine(values: (string | number | null | undefined)[]): string {
  return values.map(csvCell).join(",") + "\r\n";
}

const IST_OFFSET_MS = 330 * 60 * 1000;

/** ISO timestamp rendered in IST with an explicit +05:30 offset (what Indian participants exchange). */
export function toIstIso(d: Date): string {
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().replace("Z", "+05:30");
}

export function recordToCsvLine(r: NormalizedRecord): string {
  return toCsvLine([
    r.txnRef,
    r.parentRef,
    r.recordType,
    r.method,
    paiseToPlain(r.amountPaise),
    "INR",
    r.status,
    r.customerId,
    r.merchantId,
    r.issuingBank,
    r.acquiringBank,
    toIstIso(r.eventAt),
  ]);
}

export const CSV_HEADER_LINE = CSV_COLUMNS.join(",") + "\r\n";
