// Bootstraps an administrator: npm run create-admin -- --email ops@example.com --name "Ops Lead"
// Prints a one-time link to set the password (valid 72 hours). Safe to run in production.
import { parseArgs } from "node:util";
import { sql } from "drizzle-orm";
import { closeDb, getDb } from "@/db";
import { users } from "@/db/schema";
import { audit } from "@/server/audit";
import { createInviteLink } from "@/server/services/auth";

async function main() {
  const { values } = parseArgs({ options: { email: { type: "string" }, name: { type: "string" } } });
  const email = values.email?.trim().toLowerCase();
  const name = values.name?.trim();
  if (!email || !/^[^@\s]+@[^@\s]+$/.test(email) || !name) {
    console.error('Usage: npm run create-admin -- --email you@example.com --name "Your Name"');
    process.exit(1);
  }

  const db = getDb();
  const existing = (await db.select().from(users).where(sql`lower(${users.email}) = ${email}`).limit(1))[0];
  let userId: string;
  if (existing) {
    await db.update(users).set({ role: "admin", isActive: true }).where(sql`${users.id} = ${existing.id}`);
    userId = existing.id;
    console.log(`Existing user ${email} promoted to admin.`);
  } else {
    const [u] = await db.insert(users).values({ email, name, role: "admin" }).returning();
    userId = u.id;
    console.log(`Admin ${email} created.`);
  }
  await audit({ id: null, email: "cli", ip: null }, "user.bootstrap_admin", "user", userId, { email });
  const { url } = await createInviteLink(userId);
  console.log(`Set the password within 72 hours:\n${url}`);
  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
