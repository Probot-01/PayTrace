import { describe, expect, it } from "vitest";
import { accruedCompensationPaise, endOfIstDay, istDate, tatFor } from "@/domain/recon/tat";

const DAY = 86_400_000;

describe("IST calendar helpers", () => {
  it("uses the IST date, not the UTC date", () => {
    // 20:00 UTC on 27 Oct is 01:30 IST on 28 Oct.
    expect(istDate(new Date("2026-10-27T20:00:00Z"))).toBe("2026-10-28");
  });
  it("ends T+1 at 23:59:59.999 IST on the next day", () => {
    const due = endOfIstDay(new Date("2026-10-28T06:30:00Z"), 1);
    expect(due.toISOString()).toBe("2026-10-29T18:29:59.999Z");
  });
});

describe("tatFor (RBI/2019-20/67 and NEFT/RTGS rules)", () => {
  const at = new Date("2026-10-28T06:30:00Z");
  it("gives UPI failed-but-debited T+1 with ₹100/day", () => {
    const r = tatFor("FAILED_BUT_DEBITED", "UPI", at);
    expect(r.basis).toBe("RBI");
    expect(r.dueAt).toEqual(endOfIstDay(at, 1));
    expect(r.compensation).toEqual({ kind: "FLAT_PER_DAY", paisePerDay: 10_000 });
  });
  it("gives cards T+5", () => {
    expect(tatFor("FAILED_BUT_DEBITED", "DEBIT_CARD", at).dueAt).toEqual(endOfIstDay(at, 5));
    expect(tatFor("SUCCESS_MERCHANT_NOT_UPDATED", "CREDIT_CARD", at).dueAt).toEqual(endOfIstDay(at, 5));
  });
  it("gives UPI merchant payments T+5", () => {
    expect(tatFor("SUCCESS_MERCHANT_NOT_UPDATED", "UPI", at).dueAt).toEqual(endOfIstDay(at, 5));
  });
  it("gives NEFT two hours and RTGS one hour with penal interest", () => {
    const neft = tatFor("FAILED_BUT_DEBITED", "NEFT", at);
    const rtgs = tatFor("FAILED_BUT_DEBITED", "RTGS", at);
    expect(neft.dueAt.getTime() - at.getTime()).toBe(2 * 3_600_000);
    expect(rtgs.dueAt.getTime() - at.getTime()).toBe(3_600_000);
    expect(neft.compensation).toEqual({ kind: "PENAL_INTEREST", spreadBps: 200 });
  });
  it("labels non-regulatory deadlines as internal", () => {
    for (const c of ["REFUND_MISMATCH", "SETTLEMENT_MISMATCH", "AMOUNT_MISMATCH", "MISSING", "STATUS_MISMATCH"] as const) {
      const r = tatFor(c, "UPI", at);
      expect(r.basis).toBe("INTERNAL");
      expect(r.compensation.kind).toBe("NONE");
    }
  });
});

describe("accruedCompensationPaise", () => {
  const dueAt = new Date("2026-10-29T18:29:59.999Z");
  const flat = { dueAt, compensation: { kind: "FLAT_PER_DAY", paisePerDay: 10_000 } as const };
  it("owes nothing before the deadline", () => {
    expect(accruedCompensationPaise(flat, 50_000, new Date(dueAt.getTime() - 1), 550)).toBe(0);
  });
  it("owes ₹100 for each started day of delay", () => {
    expect(accruedCompensationPaise(flat, 50_000, new Date(dueAt.getTime() + 1), 550)).toBe(10_000);
    expect(accruedCompensationPaise(flat, 50_000, new Date(dueAt.getTime() + DAY + 1), 550)).toBe(20_000);
  });
  it("accrues penal interest at repo + 2% pro rata", () => {
    const rule = { dueAt, compensation: { kind: "PENAL_INTEREST", spreadBps: 200 } as const };
    // ₹10,00,000 for 365 days at 7.5% = ₹75,000.
    expect(accruedCompensationPaise(rule, 100_000_000, new Date(dueAt.getTime() + 365 * DAY), 550)).toBe(7_500_000);
  });
});
