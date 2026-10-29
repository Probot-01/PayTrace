import { describe, expect, it } from "vitest";
import { simulate, simulationConfigSchema, SIMULATION_PRESETS } from "@/domain/simulator/simulate";

const base = { ...SIMULATION_PRESETS.normal.config, transactionCount: 500, businessDate: "2026-10-28", seed: 7 };

describe("simulate", () => {
  it("is deterministic for a seed", () => {
    const a = simulate(base);
    const b = simulate(base);
    expect(a.records.length).toBe(b.records.length);
    expect(a.records.slice(0, 50)).toEqual(b.records.slice(0, 50));
  });

  it("produces every transaction field the brief asks for", () => {
    const t = simulate(base).transactions[0];
    for (const k of ["txnRef", "customerId", "merchantId", "amountPaise", "method", "initiatedAt", "issuingBank", "acquiringBank", "switchStatus", "bankStatus", "merchantStatus", "settlementStatus", "refundStatus"]) {
      expect(t).toHaveProperty(k);
    }
  });

  it("keeps every event on the business date in IST (plus late settlement)", () => {
    const out = simulate(base);
    for (const t of out.transactions) {
      const ist = new Date(t.initiatedAt.getTime() + 330 * 60_000).toISOString().slice(0, 10);
      expect(ist).toBe("2026-10-28");
    }
  });

  it("uses unique references", () => {
    const refs = simulate({ ...base, transactionCount: 5000 }).transactions.map((t) => t.txnRef);
    expect(new Set(refs).size).toBe(refs.length);
  });

  it("rejects fault rates that add up to more than 90%", () => {
    const bad = { ...base, faultRates: Object.fromEntries(Object.keys(base.faultRates).map((k) => [k, 0.3])) };
    expect(simulationConfigSchema.safeParse(bad).success).toBe(false);
  });
});
