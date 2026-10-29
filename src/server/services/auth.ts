import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { passwordTokens, users } from "@/db/schema";
import { env, isProduction } from "@/lib/env";
import { AppError, badRequest, tooManyRequests, validationFailed } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { audit } from "../audit";
import { hashPassword, passwordSchema, verifyPassword } from "../auth/password";
import { createSession, invalidateUserSessions } from "../auth/session";
import { generateToken, hashToken } from "../auth/tokens";
import { sendMail } from "../mailer";
import { clearRateLimit, hitRateLimit } from "../rate-limit";

const LOCK_AFTER_FAILURES = 10;
const LOCK_MINUTES = 15;
const RESET_TTL_MINUTES = 30;
const INVITE_TTL_HOURS = 72;

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(254),
  password: z.string().min(1, "Enter your password.").max(256),
});

const INVALID = () => new AppError(401, "INVALID_CREDENTIALS", "Email or password is incorrect.");

export async function login(input: z.infer<typeof loginSchema>, meta: { ip: string | null; userAgent: string | null }) {
  const { email, password } = input;
  const perAccount = await hitRateLimit(`login:acct:${email}`, 10, 15 * 60);
  const perIp = meta.ip ? await hitRateLimit(`login:ip:${meta.ip}`, 50, 15 * 60) : { allowed: true, retryAfterSeconds: 0 };
  if (!perAccount.allowed || !perIp.allowed) {
    await audit({ id: null, email, ip: meta.ip }, "auth.login_throttled", "user", null, {});
    throw tooManyRequests(Math.max(perAccount.retryAfterSeconds, perIp.retryAfterSeconds));
  }

  const db = getDb();
  const user = (
    await db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${email}`)
      .limit(1)
  )[0];
  const ok = await verifyPassword(user?.passwordHash ?? null, password);

  if (!user || !user.isActive) {
    await audit({ id: null, email, ip: meta.ip }, "auth.login_failed", "user", user?.id ?? null, { reason: user ? "inactive" : "unknown" });
    throw INVALID();
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    await audit({ id: user.id, email, ip: meta.ip }, "auth.login_failed", "user", user.id, { reason: "locked" });
    throw new AppError(
      423,
      "ACCOUNT_LOCKED",
      `Too many failed attempts. The account is locked until ${user.lockedUntil.toISOString().slice(11, 16)} UTC, or ask an administrator for a reset link.`,
    );
  }
  if (!ok) {
    const failures = user.failedLoginCount + 1;
    await db
      .update(users)
      .set({
        failedLoginCount: failures,
        lockedUntil: failures >= LOCK_AFTER_FAILURES ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
      })
      .where(eq(users.id, user.id));
    await audit({ id: user.id, email, ip: meta.ip }, "auth.login_failed", "user", user.id, { reason: "password", failures });
    throw INVALID();
  }

  await db.update(users).set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() }).where(eq(users.id, user.id));
  await clearRateLimit(`login:acct:${email}`);
  const session = await createSession(user.id, meta);
  await audit({ id: user.id, email: user.email, ip: meta.ip }, "auth.login", "user", user.id);
  return { ...session, user: { id: user.id, name: user.name, role: user.role } };
}

async function issueToken(userId: string, purpose: "INVITE" | "RESET") {
  const token = generateToken();
  const ttl = purpose === "INVITE" ? INVITE_TTL_HOURS * 60 : RESET_TTL_MINUTES;
  const db = getDb();
  // Only the newest link of each purpose stays valid.
  await db
    .update(passwordTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(passwordTokens.userId, userId), eq(passwordTokens.purpose, purpose), isNull(passwordTokens.usedAt)));
  await db.insert(passwordTokens).values({ id: hashToken(token), userId, purpose, expiresAt: new Date(Date.now() + ttl * 60_000) });
  return { token, url: `${env().APP_URL}/reset-password?token=${encodeURIComponent(token)}` };
}

export async function createInviteLink(userId: string) {
  return issueToken(userId, "INVITE");
}

export async function createResetLink(userId: string) {
  return issueToken(userId, "RESET");
}

/** Always resolves the same way whether or not the email exists (no account enumeration). */
export async function requestPasswordReset(emailInput: string, ip: string | null) {
  const email = emailInput.trim().toLowerCase();
  const limit = await hitRateLimit(`reset:${email}`, 3, 60 * 60);
  if (!limit.allowed) return;
  const user = (
    await getDb()
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${email}`)
      .limit(1)
  )[0];
  await audit({ id: null, email, ip }, "auth.reset_requested", "user", user?.id ?? null);
  if (!user || !user.isActive) return;
  const { url } = await createResetLink(user.id);
  const sent = await sendMail(
    user.email,
    "Reset your PayTrace password",
    `A password reset was requested for your PayTrace account.\n\nOpen this link within ${RESET_TTL_MINUTES} minutes to choose a new password:\n${url}\n\nIf you did not ask for this, ignore this email; your password is unchanged.`,
  );
  if (!sent && !isProduction()) logger.info({ resetUrl: url }, "SMTP not configured: password reset link (development only)");
}

export const resetSchema = z.object({ token: z.string().min(20).max(100), password: z.string() });

export async function resetPassword(input: z.infer<typeof resetSchema>, ip: string | null) {
  const pw = passwordSchema.safeParse(input.password);
  if (!pw.success) throw validationFailed(z.flattenError(pw.error), pw.error.issues[0].message);
  const db = getDb();
  const id = hashToken(input.token);
  const passwordHash = await hashPassword(pw.data);
  const userId = await db.transaction(async (tx) => {
    const [tok] = await tx
      .update(passwordTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(passwordTokens.id, id), isNull(passwordTokens.usedAt), gt(passwordTokens.expiresAt, new Date())))
      .returning();
    if (!tok) throw badRequest("This link is invalid or has expired. Ask for a new one.");
    const [user] = await tx
      .update(users)
      .set({ passwordHash, passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null, updatedAt: new Date() })
      .where(and(eq(users.id, tok.userId), eq(users.isActive, true)))
      .returning();
    if (!user) throw badRequest("This account is disabled.");
    await audit(
      { id: user.id, email: user.email, ip },
      tok.purpose === "INVITE" ? "auth.invite_accepted" : "auth.password_reset",
      "user",
      user.id,
      {},
      tx,
    );
    return user.id;
  });
  await invalidateUserSessions(userId);
}

export const changePasswordSchema = z.object({ currentPassword: z.string().min(1).max(256), newPassword: z.string() });

export async function changePassword(userId: string, sessionId: string, input: z.infer<typeof changePasswordSchema>, ip: string | null) {
  const db = getDb();
  const user = (await db.select().from(users).where(eq(users.id, userId)).limit(1))[0];
  if (!user) throw badRequest("Account not found.");
  if (!(await verifyPassword(user.passwordHash, input.currentPassword))) {
    throw validationFailed({ fieldErrors: { currentPassword: ["Current password is incorrect."] } }, "Current password is incorrect.");
  }
  const pw = passwordSchema.safeParse(input.newPassword);
  if (!pw.success) throw validationFailed({ fieldErrors: { newPassword: pw.error.issues.map((i) => i.message) } }, pw.error.issues[0].message);
  if (input.newPassword === input.currentPassword) {
    throw validationFailed({ fieldErrors: { newPassword: ["Choose a password different from the current one."] } }, "Choose a different password.");
  }
  await db
    .update(users)
    .set({ passwordHash: await hashPassword(pw.data), passwordChangedAt: new Date(), updatedAt: new Date() })
    .where(eq(users.id, userId));
  await invalidateUserSessions(userId, sessionId);
  await audit({ id: user.id, email: user.email, ip }, "auth.password_changed", "user", user.id);
}
