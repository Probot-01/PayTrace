import { and, asc, count, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { sessions, users } from "@/db/schema";
import { USER_ROLES } from "@/domain/types";
import { conflict, forbidden, notFound } from "@/lib/errors";
import { audit, type AuditActor } from "../audit";
import { invalidateUserSessions } from "../auth/session";
import { mailConfigured, sendMail } from "../mailer";
import { createInviteLink, createResetLink } from "./auth";

export const createUserSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(254),
  name: z.string().trim().min(2, "Enter the person's name.").max(100),
  role: z.enum(USER_ROLES),
});

export const updateUserSchema = z
  .object({
    name: z.string().trim().min(2).max(100).optional(),
    role: z.enum(USER_ROLES).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nothing to update.");

const publicColumns = {
  id: users.id,
  email: users.email,
  name: users.name,
  role: users.role,
  isActive: users.isActive,
  lastLoginAt: users.lastLoginAt,
  createdAt: users.createdAt,
  lockedUntil: users.lockedUntil,
  hasPassword: sql<boolean>`${users.passwordHash} is not null`,
};

export async function listUsers() {
  return getDb().select(publicColumns).from(users).orderBy(asc(users.name));
}

export async function listAssignableUsers() {
  return getDb()
    .select({ id: users.id, name: users.name, role: users.role })
    .from(users)
    .where(and(eq(users.isActive, true), ne(users.role, "viewer")))
    .orderBy(asc(users.name));
}

export async function createUser(actor: AuditActor, input: z.infer<typeof createUserSchema>) {
  const db = getDb();
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${input.email}`)
    .limit(1);
  if (existing.length) throw conflict("A user with this email already exists.");
  const [user] = await db.insert(users).values({ email: input.email, name: input.name, role: input.role }).returning(publicColumns);
  const { url } = await createInviteLink(user.id);
  const emailed = await sendMail(
    user.email,
    "You have been invited to PayTrace",
    `${actor.email ?? "An administrator"} invited you to PayTrace as ${input.role}.\n\nSet your password within 72 hours:\n${url}`,
  );
  await audit(actor, "user.create", "user", user.id, { email: user.email, role: user.role });
  return { user, inviteUrl: url, emailed, mailConfigured: mailConfigured() };
}

async function activeAdminCount(excludeId: string) {
  const [row] = await getDb()
    .select({ n: count() })
    .from(users)
    .where(and(eq(users.role, "admin"), eq(users.isActive, true), ne(users.id, excludeId)));
  return row.n;
}

export async function updateUser(actor: AuditActor, id: string, input: z.infer<typeof updateUserSchema>) {
  const db = getDb();
  const [target] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!target) throw notFound("User");
  if (id === actor.id && (input.role !== undefined || input.isActive === false)) {
    throw forbidden("You cannot change your own role or deactivate yourself.");
  }
  const losingAdmin = target.role === "admin" && target.isActive && ((input.role && input.role !== "admin") || input.isActive === false);
  if (losingAdmin && (await activeAdminCount(id)) === 0) {
    throw conflict("At least one active administrator is required.");
  }
  const [updated] = await db
    .update(users)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning(publicColumns);
  if (input.isActive === false || (input.role && input.role !== target.role)) {
    // Role changes and deactivation take effect immediately.
    await invalidateUserSessions(id);
  }
  await audit(actor, "user.update", "user", id, {
    before: { name: target.name, role: target.role, isActive: target.isActive },
    after: input,
  });
  return updated;
}

export async function issueUserResetLink(actor: AuditActor, id: string) {
  const [target] = await getDb().select().from(users).where(eq(users.id, id)).limit(1);
  if (!target) throw notFound("User");
  if (!target.isActive) throw conflict("Reactivate the user before issuing a reset link.");
  const { url } = target.passwordHash ? await createResetLink(id) : await createInviteLink(id);
  await getDb().update(users).set({ lockedUntil: null, failedLoginCount: 0 }).where(eq(users.id, id));
  const emailed = await sendMail(target.email, "PayTrace password link", `Use this link to set your PayTrace password:\n${url}`);
  await audit(actor, "user.reset_link_issued", "user", id);
  return { url, emailed };
}

export async function listSessionsForUser(userId: string) {
  return getDb()
    .select({
      id: sessions.id,
      createdAt: sessions.createdAt,
      lastSeenAt: sessions.lastSeenAt,
      expiresAt: sessions.expiresAt,
      ip: sessions.ip,
      userAgent: sessions.userAgent,
    })
    .from(sessions)
    .where(eq(sessions.userId, userId))
    .orderBy(asc(sessions.createdAt));
}

export async function revokeOwnSession(actor: AuditActor & { id: string }, sessionId: string) {
  const res = await getDb()
    .delete(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, actor.id)))
    .returning({ id: sessions.id });
  if (!res.length) throw notFound("Session");
  await audit(actor, "auth.session_revoked", "session", null);
}
