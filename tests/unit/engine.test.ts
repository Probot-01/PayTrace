import { describe, expect, it } from "vitest";
import { DEFAULT_RECON_CONFIG, reconcile, severityFor } from "@/domain/recon/engine";
import type { NormalizedRecord, PaymentMethod, RecordStatus, SourceSystem } from "@/domain/types";

const T0 = new Date("2026-10-28T06:30:00Z"); // 12:00 IST

function rec(source: SourceSystem, status: RecordStatus, over: Partial<NormalizedRecord> = {}): NormalizedRecord {
  return {
    source,
    txnRef: "630100000001",
    parentRef: null,
    recordType: "PAYMENT",
    method: "UPI",
    amountPaise: 50_000,
    status,
    customerId: "CUST1",
    merchantId: "MER1",
    issuingBank: "HDFC0000001",
    acquiringBank: "ICIC0000001",
    eventAt: T0,
    ...over,
  };
}

/** A clean, fully matched payment seen by all five participants. */
function clean(over: Partial<NormalizedRecord> = {}): NormalizedRecord[] {
  return (["SWITCH", "ISSUER", "ACQUIRER", "MERCHANT", "SETTLEMENT"] as const).map((s) => rec(s, "SUCCESS", over));
}

const categories = (records: NormalizedRecord[]) =>
  reconcile(records)
    .exceptions.map((e) => e.category)
    .sort();

describe("reconcile: clean flows", () => {
  it("matches a payment every participant agrees on", () => {
    const r = reconcile(clean());
    expect(r.exceptions).toEqual([]);
    expect(r.stats.totalTransactions).toBe(1);
    expect(r.stats.matched).toBe(1);
    expect(r.stats.reconciliationRate).toBe(1);
  });

  it("accepts a cleanly failed payment that only the switch and issuer saw", () => {
    expect(categories([rec("SWITCH", "FAILED"), rec("ISSUER", "FAILED")])).toEqual([]);
  });

  it("accepts a failed payment that was debited and then reversed", () => {
    const records = [
      rec("SWITCH", "FAILED"),
      rec("ISSUER", "SUCCESS"),
      rec("ISSUER", "SUCCESS", { recordType: "REVERSAL", txnRef: "RV1", parentRef: "630100000001" }),
    ];
    expect(categories(records)).not.toContain("FAILED_BUT_DEBITED");
  });
});

describe("reconcile: the nine exception categories", () => {
  it("SUCCESS_MERCHANT_NOT_UPDATED when the merchant has no record", () => {
    const records = clean().filter((r) => r.source !== "MERCHANT");
    const [e] = reconcile(records).exceptions;
    expect(e.category).toBe("SUCCESS_MERCHANT_NOT_UPDATED");
    expect(e.failurePoint).toBe("MERCHANT");
    expect(e.affectedPaise).toBe(50_000);
  });

  it("FAILED_BUT_DEBITED when the issuer debited but the acquirer failed and nothing was reversed", () => {
    const records = [rec("SWITCH", "FAILED"), rec("ISSUER", "SUCCESS"), rec("ACQUIRER", "FAILED")];
    const [e] = reconcile(records).exceptions;
    expect(e.category).toBe("FAILED_BUT_DEBITED");
    expect(e.failurePoint).toBe("ACQUIRER");
  });

  it("FAILED_BUT_DEBITED when the switch never saw the debited request", () => {
    expect(categories([rec("ISSUER", "SUCCESS")])).toEqual(["FAILED_BUT_DEBITED"]);
  });

  it("DUPLICATE for the same reference debited twice", () => {
    const records = [...clean(), rec("ISSUER", "SUCCESS")];
    const e = reconcile(records).exceptions.find((x) => x.category === "DUPLICATE")!;
    expect(e.failurePoint).toBe("ISSUER");
    expect(e.affectedPaise).toBe(50_000);
  });

  it("DUPLICATE for a suspected retry: same customer, merchant and amount inside the window", () => {
    const later = new Date(T0.getTime() + 90_000);
    const records = [...clean(), ...clean({ txnRef: "630100000002", eventAt: later })];
    const dup = reconcile(records).exceptions.filter((e) => e.category === "DUPLICATE");
    expect(dup.map((d) => d.txnRef)).toEqual(["630100000002"]);
    expect(dup[0].requiresManual).toBe(true);
  });

  it("does not flag repeat purchases outside the duplicate window", () => {
    const later = new Date(T0.getTime() + 60 * 60_000);
    expect(categories([...clean(), ...clean({ txnRef: "630100000002", eventAt: later })])).toEqual([]);
  });

  it("MISSING when the switch has no record of a credited payment", () => {
    const records = clean().filter((r) => r.source !== "SWITCH");
    const e = reconcile(records).exceptions.find((x) => x.category === "MISSING")!;
    expect(e.evidence.missingSources).toEqual(["SWITCH"]);
  });

  it("AMOUNT_MISMATCH when one participant reports a different amount", () => {
    const records = clean().map((r) => (r.source === "ACQUIRER" ? { ...r, amountPaise: 49_000 } : r));
    const e = reconcile(records).exceptions.find((x) => x.category === "AMOUNT_MISMATCH")!;
    expect(e.failurePoint).toBe("ACQUIRER");
    expect(e.affectedPaise).toBe(1_000);
  });

  it("respects the amount tolerance", () => {
    const records = clean().map((r) => (r.source === "ACQUIRER" ? { ...r, amountPaise: 49_999 } : r));
    const r = reconcile(records, { ...DEFAULT_RECON_CONFIG, amountTolerancePaise: 1 });
    expect(r.exceptions.map((e) => e.category)).not.toContain("AMOUNT_MISMATCH");
  });

  it("STATUS_MISMATCH when the merchant shows paid but the payment failed", () => {
    const records = [rec("SWITCH", "FAILED"), rec("ISSUER", "FAILED"), rec("MERCHANT", "SUCCESS")];
    const [e] = reconcile(records).exceptions;
    expect(e.category).toBe("STATUS_MISMATCH");
    expect(e.failurePoint).toBe("MERCHANT");
  });

  it("STATUS_MISMATCH when a credited payment was also reversed (paid out twice)", () => {
    const records = [...clean(), rec("ISSUER", "SUCCESS", { recordType: "REVERSAL", txnRef: "RV1", parentRef: "630100000001" })];
    const e = reconcile(records).exceptions.find((x) => x.category === "STATUS_MISMATCH")!;
    expect(e.requiresManual).toBe(true);
  });

  it("DELAYED when a participant is still pending at cutoff, and stops further rules", () => {
    const records = clean().map((r) => (r.source === "ACQUIRER" ? { ...r, status: "PENDING" as const } : r));
    expect(categories(records)).toEqual(["DELAYED"]);
  });

  it("DELAYED when the beneficiary credit lags beyond the method's SLA", () => {
    const late = new Date(T0.getTime() + 30 * 60_000); // UPI SLA is 5 minutes
    const records = clean().map((r) => (r.source === "ACQUIRER" ? { ...r, eventAt: late } : r));
    const [e] = reconcile(records).exceptions;
    expect(e.category).toBe("DELAYED");
    expect(e.affectedPaise).toBe(0);
  });

  it("does not flag a slow NEFT credit inside its 2-hour window", () => {
    const late = new Date(T0.getTime() + 90 * 60_000);
    const records = clean({ method: "NEFT" }).map((r) => (r.source === "ACQUIRER" ? { ...r, eventAt: late } : r));
    expect(categories(records)).toEqual([]);
  });

  it("SETTLEMENT_MISMATCH when a successful payment is missing from settlement", () => {
    const records = clean().filter((r) => r.source !== "SETTLEMENT");
    expect(categories(records)).toEqual(["SETTLEMENT_MISMATCH"]);
  });

  it("SETTLEMENT_MISMATCH when a failed payment was settled", () => {
    const records = [rec("SWITCH", "FAILED"), rec("ISSUER", "FAILED"), rec("SETTLEMENT", "SUCCESS")];
    const e = reconcile(records).exceptions.find((x) => x.category === "SETTLEMENT_MISMATCH")!;
    expect(e.requiresManual).toBe(true);
  });

  it("SETTLEMENT_MISMATCH when the settled amount differs from the credit", () => {
    const records = clean().map((r) => (r.source === "SETTLEMENT" ? { ...r, amountPaise: 45_000 } : r));
    const e = reconcile(records).exceptions.find((x) => x.category === "SETTLEMENT_MISMATCH")!;
    expect(e.affectedPaise).toBe(5_000);
  });

  describe("REFUND_MISMATCH", () => {
    const refund = (source: SourceSystem, status: RecordStatus, over: Partial<NormalizedRecord> = {}) =>
      rec(source, status, { recordType: "REFUND", txnRef: "RF0001", parentRef: "630100000001", amountPaise: 20_000, ...over });

    it("matches a refund both sides agree on", () => {
      expect(categories([...clean(), refund("MERCHANT", "SUCCESS"), refund("ISSUER", "SUCCESS")])).toEqual([]);
    });

    it("flags a merchant refund the customer never received", () => {
      expect(categories([...clean(), refund("MERCHANT", "SUCCESS")])).toEqual(["REFUND_MISMATCH"]);
    });

    it("flags a pending refund", () => {
      expect(categories([...clean(), refund("MERCHANT", "SUCCESS"), refund("ISSUER", "PENDING")])).toEqual(["REFUND_MISMATCH"]);
    });

    it("flags refunds that exceed the original payment", () => {
      const records = [
        ...clean(),
        refund("MERCHANT", "SUCCESS", { amountPaise: 40_000 }),
        refund("ISSUER", "SUCCESS", { amountPaise: 40_000 }),
        refund("MERCHANT", "SUCCESS", { txnRef: "RF0002", amountPaise: 40_000 }),
        refund("ISSUER", "SUCCESS", { txnRef: "RF0002", amountPaise: 40_000 }),
      ];
      const e = reconcile(records).exceptions.filter((x) => x.category === "REFUND_MISMATCH");
      expect(e).toHaveLength(1);
      expect(e[0].affectedPaise).toBe(30_000);
    });

    it("flags a refund whose original payment is not in the files", () => {
      expect(categories([refund("MERCHANT", "SUCCESS"), refund("ISSUER", "SUCCESS")])).toEqual(["REFUND_MISMATCH"]);
    });
  });
});

describe("reconcile: invariants", () => {
  it("raises at most one exception per reference and category", () => {
    const records = [...clean(), rec("ISSUER", "SUCCESS"), rec("ACQUIRER", "SUCCESS")];
    const keys = reconcile(records).exceptions.map((e) => `${e.txnRef}|${e.category}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("counts outcomes and per-method stats", () => {
    const methods: PaymentMethod[] = ["UPI", "NEFT", "RTGS"];
    const records = methods.flatMap((m, i) => clean({ method: m, txnRef: `REF${i}`, customerId: `C${i}` }));
    records.push(rec("SWITCH", "FAILED", { txnRef: "REFX" }), rec("ISSUER", "FAILED", { txnRef: "REFX" }));
    const { stats } = reconcile(records);
    expect(stats.totalTransactions).toBe(4);
    expect(stats.successful).toBe(3);
    expect(stats.failed).toBe(1);
    expect(stats.byMethod.NEFT).toMatchObject({ total: 1, matched: 1 });
  });

  it("does not depend on record order", () => {
    const records = [...clean().filter((r) => r.source !== "MERCHANT"), rec("ISSUER", "SUCCESS", { txnRef: "B" })];
    const a = categories(records);
    const b = categories([...records].reverse());
    expect(a).toEqual(b);
  });
});

describe("severityFor", () => {
  it("is critical at or above the high-value threshold", () => {
    expect(severityFor("AMOUNT_MISMATCH", DEFAULT_RECON_CONFIG.highValuePaise, DEFAULT_RECON_CONFIG)).toBe("CRITICAL");
  });
  it("ranks customer-impacting categories above informational delays", () => {
    const order = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
    const fbd = order.indexOf(severityFor("FAILED_BUT_DEBITED", 10_000, DEFAULT_RECON_CONFIG));
    const delayed = order.indexOf(severityFor("DELAYED", 0, DEFAULT_RECON_CONFIG));
    expect(fbd).toBeGreaterThan(delayed);
  });
});
