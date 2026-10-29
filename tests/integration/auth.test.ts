import { APP_ORIGIN, apiRequest, createUserWithPassword, resetDatabase } from "./helpers";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, getDb, getSqlClient } from "@/db";
import { auditEvents, passwordTokens, sessions, users } from "@/db/schema";
import { createResetLink, login, resetPassword } from "@/server/services/auth";
import { validateSessionToken } from "@/server/auth/session";
import { hashToken } from "@/server/auth/tokens";
import { POST as loginRoute } from "@/app/api/auth/login/route";

const meta = { ip: "10.0.0.1", userAgent: "vitest" };

beforeEach(resetDatabase);
afterAll(closeDb);

describe("login", () => {
  it("creates a session whose token is stored only as a hash", async () => {
    await createUserWithPassword("ana@example.test", "analyst");
    const s = await login({ email: "ana@example.test", password: "integration-pass-42" }, meta);
    const stored = await getDb().select().from(sessions);
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe(hashToken(s.token));
    expect(stored[0].id).not.toBe(s.token);
    expect((await validateSessionToken(s.token))?.user.email).toBe("ana@example.test");
  });

  it("gives the same error for an unknown email and a wrong password", async () => {
    await createUserWithPassword("ana@example.test", "analyst");
    const a = await login({ email: "nobody@example.test", password: "x" }, meta).catch((e) => e);
    const b = await login({ email: "ana@example.test", password: "wrong" }, meta).catch((e) => e);
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.message).toBe(b.message);
  });

  it("locks the account after 10 failures, even for the right password", async () => {
    await createUserWithPassword("ana@example.test", "analyst");
    for (let i = 0; i < 10; i++) await login({ email: "ana@example.test", password: "wrong" }, { ...meta, ip: `10.0.1.${i}` }).catch(() => {});
    const [u] = await getDb().select().from(users).where(eq(users.email, "ana@example.test"));
    expect(u.lockedUntil).not.toBeNull();
    // Clear the per-account throttle to prove the lock (not the rate limit) is what blocks it.
    await getSqlClient()`delete from rate_limits`;
    const err = await login({ email: "ana@example.test", password: "integration-pass-42" }, meta).catch((e) => e);
    expect(err.status).toBe(423);
  });

  it("throttles repeated attempts per account", async () => {
    for (let i = 0; i < 10; i++) await login({ email: "x@example.test", password: "wrong" }, { ...meta, ip: `10.0.2.${i}` }).catch(() => {});
    const err = await login({ email: "x@example.test", password: "wrong" }, meta).catch((e) => e);
    expect(err.status).toBe(429);
  });

  it("rejects inactive users", async () => {
    const u = await createUserWithPassword("gone@example.test", "admin");
    await getDb().update(users).set({ isActive: false }).where(eq(users.id, u.id));
    const err = await login({ email: "gone@example.test", password: "integration-pass-42" }, meta).catch((e) => e);
    expect(err.status).toBe(401);
  });

  it("audits successes and failures", async () => {
    await createUserWithPassword("ana@example.test", "analyst");
    await login({ email: "ana@example.test", password: "nope" }, meta).catch(() => {});
    await login({ email: "ana@example.test", password: "integration-pass-42" }, meta);
    const actions = (await getDb().select().from(auditEvents)).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["auth.login_failed", "auth.login"]));
  });
});

describe("login route", () => {
  it("sets an httpOnly session cookie", async () => {
    await createUserWithPassword("ana@example.test", "analyst");
    const res = await loginRoute(apiRequest("/api/auth/login", { json: { email: "ana@example.test", password: "integration-pass-42" } }));
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/paytrace_session=/);
    expect(cookie.toLowerCase()).toContain("httponly");
    expect(cookie.toLowerCase()).toContain("samesite=lax");
  });

  it("refuses cross-site requests (CSRF)", async () => {
    await createUserWithPassword("ana@example.test", "analyst");
    const res = await loginRoute(
      apiRequest("/api/auth/login", { json: { email: "ana@example.test", password: "integration-pass-42" }, origin: "https://evil.example" }),
    );
    expect(res.status).toBe(403);
  });

  it("returns field errors for invalid input", async () => {
    const res = await loginRoute(apiRequest("/api/auth/login", { json: { email: "not-an-email", password: "" } }));
    expect([400, 422]).toContain(res.status);
    expect(APP_ORIGIN).toBeTruthy();
  });
});

describe("password reset", () => {
  it("is single-use and signs the user out everywhere", async () => {
    const u = await createUserWithPassword("ana@example.test", "analyst");
    await login({ email: "ana@example.test", password: "integration-pass-42" }, meta);
    const { token } = await createResetLink(u.id);
    await resetPassword({ token, password: "a-brand-new-passphrase" }, meta.ip);
    expect(await getDb().select().from(sessions)).toHaveLength(0);
    const again = await resetPassword({ token, password: "another-new-passphrase" }, meta.ip).catch((e) => e);
    expect(again.status).toBeGreaterThanOrEqual(400);
    await expect(login({ email: "ana@example.test", password: "a-brand-new-passphrase" }, meta)).resolves.toBeTruthy();
  });

  it("rejects expired links", async () => {
    const u = await createUserWithPassword("ana@example.test", "analyst");
    const { token } = await createResetLink(u.id);
    await getDb().update(passwordTokens).set({ expiresAt: new Date(Date.now() - 1000) });
    const err = await resetPassword({ token, password: "a-brand-new-passphrase" }, meta.ip).catch((e) => e);
    expect(err.status).toBeGreaterThanOrEqual(400);
    expect(u.id).toBeTruthy();
  });
});

describe("audit log", () => {
  it("is append-only at the database level", async () => {
    await createUserWithPassword("ana@example.test", "analyst");
    await login({ email: "ana@example.test", password: "integration-pass-42" }, meta);
    const sql = getSqlClient();
    await expect(sql`delete from audit_events`).rejects.toThrow();
    await expect(sql`update audit_events set action = 'tampered'`).rejects.toThrow();
  });
});
