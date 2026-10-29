import { describe, expect, it } from "vitest";
import { simulate, SIMULATION_PRESETS, EXPECTED_CATEGORY } from "@/domain/simulator/simulate";
import { reconcile } from "@/domain/recon/engine";

describe("simulator → engine ground truth", () => {
  it("detects every injected fault with its expected category", () => {
    const preset = SIMULATION_PRESETS.outage.config;
    const out = simulate({ ...preset, transactionCount: 5000, businessDate: "2026-10-28", seed: 42 });
    const result = reconcile(out.records);
    const byRef = new Map<string, Set<string>>();
    for (const e of result.exceptions) {
      const s = byRef.get(e.txnRef) ?? new Set();
      s.add(e.category);
      byRef.set(e.txnRef, s);
    }
    const misses: string[] = [];
    const extras: string[] = [];
    for (const t of out.transactions) {
      const expected = EXPECTED_CATEGORY[t.injectedFault];
      const got = byRef.get(t.txnRef) ?? new Set();
      if (expected && !got.has(expected)) misses.push(`${t.injectedFault} ${t.txnRef} got=${[...got]}`);
      for (const c of got) if (c !== expected) extras.push(`${t.injectedFault} ${t.method} ${t.txnRef} extra=${c}`);
    }
    console.log(result.stats, out.faultCounts);
    console.log("misses", misses.slice(0, 20), misses.length);
    console.log("extras", extras.slice(0, 30), extras.length);
    expect(misses).toEqual([]);
  });
});
