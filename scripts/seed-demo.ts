// Development/demo data: four role accounts plus a simulated business day that is already reconciled.
// Refuses to run against production unless --allow-production is passed. Never modifies existing users.
import { parseArgs } from "node:util";
import { sql } from "drizzle-orm";
import { closeDb, getDb } from "@/db";
import { users } from "@/db/schema";
import { SIMULATION_PRESETS } from "@/domain/simulator/simulate";
import { hashPassword } from "@/server/auth/password";
import { createRun, getRun } from "@/server/services/runs";
import { createSimulation, getSimulation, simulationCount } from "@/server/services/simulations";
import { drainJobs } from "@/server/worker";

// Drains jobs in-process, but also waits for a separate worker (e.g. docker compose) that may have claimed them.
async function waitForJob(kind: string, id: string, status: () => Promise<string>) {
  for (let i = 0; i < 600; i++) {
    await drainJobs("seed");
    const s = await status();
    if (s === "COMPLETED") return;
    if (s === "FAILED") throw new Error(`Demo ${kind} ${id} failed.`);
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Timed out waiting for demo ${kind} ${id}.`);
}

async function main() {
  const { values } = parseArgs({ options: { "allow-production": { type: "boolean", default: false }, password: { type: "string" } } });
  if (process.env.NODE_ENV === "production" && !values["allow-production"]) {
    console.error("Refusing to seed demo data with NODE_ENV=production. Pass --allow-production for a demo environment.");
    process.exit(1);
  }
  // Each account's password defaults to its role name (admin/admin, ...); --password or DEMO_PASSWORD sets one for all.
  const shared = values.password ?? process.env.DEMO_PASSWORD;
  const demo = [
    { email: "admin@demo.test", name: "Asha Admin", role: "admin" },
    { email: "supervisor@demo.test", name: "Suresh Supervisor", role: "supervisor" },
    { email: "analyst@demo.test", name: "Anita Analyst", role: "analyst" },
    { email: "viewer@demo.test", name: "Vikram Viewer", role: "viewer" },
  ] as const;

  const db = getDb();
  let adminId: string | undefined;
  for (const u of demo) {
    const existing = (
      await db
        .select()
        .from(users)
        .where(sql`lower(${users.email}) = ${u.email}`)
        .limit(1)
    )[0];
    if (existing) {
      console.log(`= ${u.email} exists, left unchanged`);
      if (u.role === "admin") adminId = existing.id;
      continue;
    }
    const [row] = await db
      .insert(users)
      .values({ ...u, passwordHash: await hashPassword(shared ?? u.role), passwordChangedAt: new Date() })
      .returning();
    if (u.role === "admin") adminId = row.id;
    console.log(`+ ${u.email} (${u.role})`);
  }

  if ((await simulationCount()) > 0) {
    console.log("Simulated data already exists; skipping the demo day.");
    await closeDb();
    return;
  }

  const actor = { id: adminId ?? null, email: "seed", ip: null };
  const yesterday = new Date(Date.now() - 86_400_000 + 330 * 60_000).toISOString().slice(0, 10);
  const preset = SIMULATION_PRESETS.normal.config;
  const sim = await createSimulation(actor, {
    name: `Demo: normal day ${yesterday}`,
    config: { ...preset, transactionCount: 3_000, businessDate: yesterday, seed: 20261029 },
  });
  await waitForJob("simulation", sim.id, async () => (await getSimulation(sim.id)).sim.status);
  const { files } = await getSimulation(sim.id);
  const run = await createRun(actor, { businessDate: yesterday, fileIds: files.map((f) => f.id) });
  await waitForJob("run", run.id, async () => (await getRun(run.id)).status);
  console.log(
    `Demo simulation and reconciliation for ${yesterday} created. Demo passwords: ${shared ? "(as provided)" : "the role name, e.g. admin@demo.test / admin"}`,
  );
  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
