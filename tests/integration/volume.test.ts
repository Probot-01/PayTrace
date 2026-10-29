import { createUserWithPassword, resetDatabase } from "./helpers";
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, getDb } from "@/db";
import { reconRuns } from "@/db/schema";
import { SIMULATION_PRESETS } from "@/domain/simulator/simulate";
import { drainJobs } from "@/server/worker";
import { createSimulation, detectionAccuracy, getSimulation } from "@/server/services/simulations";
import { createRun } from "@/server/services/runs";

afterAll(closeDb);

// End-to-end volume check through PostgreSQL: generate, persist, reconcile and store 100k transactions.
describe("volume through the database", () => {
  it("simulates and reconciles 100,000 transactions", async () => {
    await resetDatabase();
    const u = await createUserWithPassword("volume@example.test", "analyst");
    const actor = { id: u.id, email: u.email, ip: null };
    const config = { ...SIMULATION_PRESETS.normal.config, transactionCount: 100_000, businessDate: "2026-10-28", seed: 5 };

    let t = performance.now();
    const sim = await createSimulation(actor, { name: "Volume", config });
    await drainJobs("volume");
    const simulateMs = performance.now() - t;
    const { files } = await getSimulation(sim.id);
    const records = files.reduce((n, f) => n + f.rowCount, 0);

    t = performance.now();
    const run = await createRun(actor, { businessDate: "2026-10-28", fileIds: files.map((f) => f.id) });
    await drainJobs("volume");
    const runMs = performance.now() - t;

    const [done] = await getDb().select().from(reconRuns).where(eq(reconRuns.id, run.id));
    console.log(`volume: ${records} records; simulate+persist ${Math.round(simulateMs)} ms; reconcile+persist ${Math.round(runMs)} ms`);
    expect(done.status).toBe("COMPLETED");
    expect(done.totalTransactions).toBeGreaterThanOrEqual(100_000);
    expect((await detectionAccuracy(sim.id, run.id)).recall).toBe(1);
  }, 600_000);
});
