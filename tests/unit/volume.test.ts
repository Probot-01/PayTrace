import { describe, expect, it } from "vitest";
import { reconcile } from "@/domain/recon/engine";
import { EXPECTED_CATEGORY, simulate, SIMULATION_PRESETS } from "@/domain/simulator/simulate";

describe("volume", () => {
  it("reconciles 100,000 transactions with full recall in well under a minute", () => {
    const out = simulate({ ...SIMULATION_PRESETS.festive.config, transactionCount: 100_000, businessDate: "2026-10-28", seed: 2026 });
    const started = performance.now();
    const result = reconcile(out.records);
    const ms = performance.now() - started;
    console.log(`reconciled ${out.records.length} records / ${result.stats.totalTransactions} transactions in ${Math.round(ms)} ms`);

    const raised = new Set(result.exceptions.map((e) => `${e.txnRef}|${e.category}`));
    const missed = out.transactions.filter((t) => {
      const expected = EXPECTED_CATEGORY[t.injectedFault];
      return expected && !raised.has(`${t.txnRef}|${expected}`);
    });
    expect(missed).toHaveLength(0);
    expect(result.stats.totalTransactions).toBeGreaterThanOrEqual(100_000);
    expect(ms).toBeLessThan(30_000);
  }, 120_000);
});
