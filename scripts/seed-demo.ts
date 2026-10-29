// Development/demo data: four role accounts plus a simulated business day that is already reconciled.
// Refuses to run against production unless --allow-production is passed. Never modifies existing users.
import { parseArgs } from "node:util";
import { sql } from "drizzle-orm";
import { closeDb, getDb } from "@/db";
import { users } from "@/db/schema";
import { SIMULATION_PRESETS } from "@/domain/simulator/simulate";
import { hashPassword } from "@/server/auth/password";
import { createRun } from "@/server/services/runs";
import { createSimulation, getSimulation } from "@/server/services/simulations";
import { drainJobs } from "@/server/worker";

async function main() {
  const { values } = parseArgs({ options: { "allow-production": { type: "boolean", default: false }, password: { type: "string" } } });
  if (process.env.NODE_ENV === "production" && !values["allow-production"]) {
    console.error("Refusing to seed demo data with NODE_ENV=production. Pass --allow-production for a demo environment.");
    process.exit(1);
  }
  const password = values.password ?? process.env.DEMO_PASSWORD ?? "PayTrace-Demo-2026";
  const demo = [
    { email: "admin@demo.paytrace.test", name: "Asha Admin", role: "admin" },
    { email: "supervisor@demo.paytrace.test", name: "Suresh Supervisor", role: "supervisor" },
    { email: "analyst@demo.paytrace.test", name: "Anita Analyst", role: "analyst" },
    { email: "viewer@demo.paytrace.test", name: "Vikram Viewer", role: "viewer" },
  ] as const;

  const db = getDb();
  const hash = await hashPassword(password);
  let adminId: string | undefined;
  for (const u of demo) {
    const existing = (await db.select().from(users).where(sql`lower(${users.email}) = ${u.email}`).limit(1))[0];
    if (existing) {
      console.log(`= ${u.email} exists, left unchanged`);
      if (u.role === "admin") adminId = existing.id;
      continue;
    }
    const [row] = await db.insert(users).values({ ...u, passwordHash: hash, passwordChangedAt: new Date() }).returning();
    if (u.role === "admin") adminId = row.id;
    console.log(`+ ${u.email} (${u.role})`);
  }

  const actor = { id: adminId ?? null, email: "seed", ip: null };
  const yesterday = new Date(Date.now() - 86_400_000 + 330 * 60_000).toISOString().slice(0, 10);
  const preset = SIMULATION_PRESETS.normal.config;
  const sim = await createSimulation(actor, {
    name: `Demo: normal day ${yesterday}`,
    config: { ...preset, transactionCount: 3_000, businessDate: yesterday, seed: 20261029 },
  });
  await drainJobs("seed");
  const { files } = await getSimulation(sim.id);
  await createRun(actor, { businessDate: yesterday, fileIds: files.map((f) => f.id) });
  await drainJobs("seed");
  console.log(`Demo simulation and reconciliation for ${yesterday} created. Demo password: ${password === "PayTrace-Demo-2026" ? "PayTrace-Demo-2026 (default)" : "(as provided)"}`);
  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
