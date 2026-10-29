import { describe, expect, it } from "vitest";
import { CSV_HEADER_LINE, csvCell, looksLikeCardNumber, normaliseStatus, parseParticipantCsv, recordToCsvLine } from "@/domain/ingest/csv-format";

const HEADER = CSV_HEADER_LINE.trim();
const row = (over: Record<string, string> = {}) => {
  const base: Record<string, string> = {
    txn_ref: "630100000001",
    parent_ref: "",
    record_type: "PAYMENT",
    payment_method: "UPI",
    amount: "500.00",
    currency: "INR",
    status: "SUCCESS",
    customer_id: "CUST1",
    merchant_id: "MER1",
    issuing_bank: "HDFC",
    acquiring_bank: "ICIC",
    event_at: "2026-10-28T12:00:00+05:30",
    ...over,
  };
  return HEADER.split(",")
    .map((k) => base[k])
    .join(",");
};

describe("parseParticipantCsv", () => {
  it("parses a valid file into paise and UTC instants", () => {
    const r = parseParticipantCsv(`${HEADER}\n${row()}\n`, "ISSUER");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.records[0]).toMatchObject({ source: "ISSUER", amountPaise: 50_000, status: "SUCCESS", method: "UPI" });
    expect(r.records[0].eventAt.toISOString()).toBe("2026-10-28T06:30:00.000Z");
  });

  it("round-trips the records it exports", () => {
    const first = parseParticipantCsv(`${HEADER}\n${row({ amount: "1234.5" })}\n`, "SWITCH");
    if (!first.ok) throw new Error("parse failed");
    const again = parseParticipantCsv(CSV_HEADER_LINE + recordToCsvLine(first.records[0]), "SWITCH");
    if (!again.ok) throw new Error("re-parse failed");
    expect(again.records[0].amountPaise).toBe(123_450);
    expect(again.records[0].eventAt).toEqual(first.records[0].eventAt);
  });

  it("accepts participant status and method aliases", () => {
    const r = parseParticipantCsv(`${HEADER}\n${row({ status: "deemed", payment_method: "dc" })}\n`, "ACQUIRER");
    expect(r.ok && r.records[0]).toMatchObject({ status: "PENDING", method: "DEBIT_CARD" });
  });

  it("reports a missing column", () => {
    const r = parseParticipantCsv("txn_ref,amount\n1,2\n", "ISSUER");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0].message).toMatch(/Missing column/);
  });

  it("reports row-level errors with line numbers", () => {
    const r = parseParticipantCsv(`${HEADER}\n${row()}\n${row({ amount: "12.345" })}\n${row({ status: "MAYBE" })}\n`, "ISSUER");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.totalErrors).toBe(2);
    expect(r.errors.map((e) => e.line)).toEqual([3, 4]);
  });

  it("rejects card numbers in identifier columns", () => {
    const r = parseParticipantCsv(`${HEADER}\n${row({ customer_id: "4111111111111111" })}\n`, "ISSUER");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0].message).toMatch(/card number/);
  });

  it("requires a parent reference on refunds", () => {
    const r = parseParticipantCsv(`${HEADER}\n${row({ record_type: "REFUND" })}\n`, "MERCHANT");
    expect(r.ok).toBe(false);
  });

  it("rejects a header-only file", () => {
    expect(parseParticipantCsv(`${HEADER}\n`, "ISSUER").ok).toBe(false);
  });
});

describe("CSV helpers", () => {
  it("neutralises spreadsheet formulas", () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell(-5)).toBe("-5");
  });
  it("quotes commas and newlines", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell("a\nb")).toBe('"a\nb"');
  });
  it("detects Luhn-valid card numbers only", () => {
    expect(looksLikeCardNumber("4111 1111 1111 1111")).toBe(true);
    expect(looksLikeCardNumber("4111111111111112")).toBe(false);
    expect(looksLikeCardNumber("CUST00012345")).toBe(false);
  });
  it("normalises status codes", () => {
    expect(normaliseStatus(" Success ")).toBe("SUCCESS");
    expect(normaliseStatus("in-progress")).toBe("PENDING");
    expect(normaliseStatus("nope")).toBeNull();
  });
});
