import { apiRequest, createUserWithPassword, params, resetDatabase, sessionCookieFor } from "./helpers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, gte } from "drizzle-orm";
import { closeDb, getDb } from "@/db";
import { auditEvents, exceptionActivity, exceptions, reconRuns } from "@/db/schema";
import { CSV_HEADER_LINE } from "@/domain/ingest/csv-format";
import { SIMULATION_PRESETS } from "@/domain/simulator/simulate";
import { drainJobs } from "@/server/worker";
import { createSimulation, detectionAccuracy, getSimulation } from "@/server/services/simulations";
import { createRun } from "@/server/services/runs";
import { getSettings, updateSettings } from "@/server/services/settings";
import { transitionException } from "@/server/services/exceptions";
import { POST as uploadRoute } from "@/app/api/v1/files/route";
import { POST as createRunRoute } from "@/app/api/v1/runs/route";
import { POST as transitionRoute } from "@/app/api/v1/exceptions/[id]/transition/route";
import { PUT as settingsRoute } from "@/app/api/v1/settings/route";
import { GET as exportRoute } from "@/app/api/v1/exceptions/export/route";

type U = Awaited<ReturnType<typeof createUserWithPassword>>;
let admin: U, supervisor: U, supervisor2: U, analyst: U, viewer: U;
let simId: string;
let runId: string;
const actor = (u: U) => ({ id: u.id, email: u.email, role: u.role, ip: null });

beforeAll(async () => {
  await resetDatabase();
  admin = await createUserWithPassword("admin@example.test", "admin");
  supervisor = await createUserWithPassword("sup@example.test", "supervisor");
  supervisor2 = await createUserWithPassword("sup2@example.test", "supervisor");
  analyst = await createUserWithPassword("ana@example.test", "analyst");
  viewer = await createUserWithPassword("view@example.test", "viewer");

  // A low approval threshold so most exceptions exercise the maker-checker path.
  await updateSettings(actor(admin), { ...(await getSettings()), approvalThresholdPaise: 100 });
  const config = { ...SIMULATION_PRESETS.outage.config, transactionCount: 2000, businessDate: "2026-10-28", seed: 99 };
  const sim = await createSimulation(actor(analyst), { name: "Integration outage", config });
  simId = sim.id;
  expect(await drainJobs("test")).toBe(1);
  const { files } = await getSimulation(simId);
  const run = await createRun(actor(analyst), { businessDate: "2026-10-28", fileIds: files.map((f) => f.id) });
  runId = run.id;
  expect(await drainJobs("test")).toBe(1);
}, 120_000);
afterAll(closeDb);

describe("simulate → reconcile through the job queue", () => {
  it("writes one file per participant and completes the run", async () => {
    const { sim, files } = await getSimulation(simId);
    expect(sim.status).toBe("COMPLETED");
    expect(files.map((f) => f.source).sort()).toEqual(["ACQUIRER", "ISSUER", "MERCHANT", "SETTLEMENT", "SWITCH"]);
    const [run] = await getDb().select().from(reconRuns).where(eq(reconRuns.id, runId));
    expect(run.status).toBe("COMPLETED");
    expect(run.totalTransactions).toBeGreaterThanOrEqual(2000);
    expect(run.exceptionCount).toBeGreaterThan(0);
  });

  it("detects every injected fault (100% recall against simulator ground truth)", async () => {
    const acc = await detectionAccuracy(simId, runId);
    expect(acc.expectedFaults).toBeGreaterThan(50);
    expect(acc.recall).toBe(1);
    expect(acc.precision).toBeGreaterThan(0.9);
  });

  it("stores a TAT deadline and basis on every exception", async () => {
    const rows = await getDb().select().from(exceptions).where(eq(exceptions.runId, runId));
    expect(rows.every((r) => r.tatDueAt && (r.tatBasis === "RBI" || r.tatBasis === "INTERNAL"))).toBe(true);
    expect(new Set(rows.map((r) => r.category)).size).toBeGreaterThanOrEqual(8);
  });
});

describe("exception workflow (maker-checker, four eyes, optimistic locking)", () => {
  /** An open exception at or above the approval threshold. */
  async function pick() {
    const { approvalThresholdPaise } = await getSettings();
    const [e] = await getDb()
      .select()
      .from(exceptions)
      .where(and(eq(exceptions.runId, runId), eq(exceptions.status, "OPEN"), gte(exceptions.affectedPaise, approvalThresholdPaise)))
      .limit(1);
    expect(e, "no open exception above the threshold").toBeTruthy();
    return e;
  }

  it("sends a high-value analyst resolution for approval, which only a different supervisor can give", async () => {
    const e = await pick();
    const proposed = await transitionException(actor(analyst), e.id, {
      action: "resolve",
      version: e.version,
      resolutionCode: "MANUAL_REVERSAL_ISSUED",
      note: "Reversal confirmed in issuer file",
    });
    expect(proposed.status).toBe("PENDING_APPROVAL");

    const selfApprove = await transitionException(actor(analyst), e.id, { action: "approve", version: proposed.version }).catch((x) => x);
    expect(selfApprove.status).toBe(403);

    const approved = await transitionException(actor(supervisor), e.id, { action: "approve", version: proposed.version });
    expect(approved.status).toBe("RESOLVED");
    expect(approved.resolvedBy).toBe(supervisor.id);

    const activity = await getDb().select().from(exceptionActivity).where(eq(exceptionActivity.exceptionId, e.id));
    expect(activity.map((a) => a.toStatus)).toEqual(expect.arrayContaining(["PENDING_APPROVAL", "RESOLVED"]));
  });

  it("stops a supervisor approving their own proposal", async () => {
    const e = await pick();
    const proposed = await transitionException(actor(analyst), e.id, { action: "dismiss", version: e.version, note: "Not a real break: test data" });
    const sentBack = await transitionException(actor(supervisor), e.id, {
      action: "reject",
      version: proposed.version,
      note: "Need the bank confirmation",
    });
    expect(sentBack.status).toBe("IN_REVIEW");
    const again = await transitionException(actor(analyst), e.id, {
      action: "dismiss",
      version: sentBack.version,
      note: "Bank confirmed, see ticket 42",
    });
    const own = await transitionException({ ...actor(supervisor2), id: analyst.id }, e.id, { action: "approve", version: again.version }).catch(
      (x) => x,
    );
    expect(own.status).toBe(403);
    const ok = await transitionException(actor(supervisor2), e.id, { action: "approve", version: again.version });
    expect(ok.status).toBe("DISMISSED");
  });

  it("rejects a stale version (lost-update protection)", async () => {
    const e = await pick();
    await transitionException(actor(analyst), e.id, { action: "start_review", version: e.version });
    const stale = await transitionException(actor(supervisor), e.id, { action: "start_review", version: e.version }).catch((x) => x);
    expect(stale.status).toBe(409);
  });

  it("lets a supervisor resolve directly and reopen", async () => {
    const e = await pick();
    const r = await transitionException(actor(supervisor), e.id, {
      action: "resolve",
      version: e.version,
      resolutionCode: "OTHER",
      note: "Handled by the bank",
    });
    expect(r.status).toBe("RESOLVED");
    const reopened = await transitionException(actor(supervisor2), e.id, { action: "reopen", version: r.version, note: "Customer complained again" });
    expect(reopened.status).toBe("IN_REVIEW");
  });

  it("writes an audit event for every transition", async () => {
    const events = await getDb().select().from(auditEvents).where(eq(auditEvents.entityType, "exception"));
    expect(events.length).toBeGreaterThanOrEqual(8);
  });
});

describe("API authorisation and CSRF", () => {
  it("requires a session", async () => {
    const res = await createRunRoute(apiRequest("/api/v1/runs", { json: {} }), params({}));
    expect(res.status).toBe(401);
  });

  it("forbids viewers from working exceptions, even with a valid session", async () => {
    const [e] = await getDb()
      .select()
      .from(exceptions)
      .where(and(eq(exceptions.runId, runId), eq(exceptions.status, "OPEN")))
      .limit(1);
    const cookie = await sessionCookieFor(viewer.id);
    const res = await transitionRoute(
      apiRequest(`/api/v1/exceptions/${e.id}/transition`, { json: { action: "start_review", version: e.version }, cookie }),
      params({ id: e.id }),
    );
    expect(res.status).toBe(403);
  });

  it("forbids non-admins from changing settings", async () => {
    const cookie = await sessionCookieFor(supervisor.id);
    const res = await settingsRoute(apiRequest("/api/v1/settings", { method: "PUT", json: {}, cookie }), params({}));
    expect(res.status).toBe(403);
  });

  it("rejects a cross-site POST even with a valid admin session", async () => {
    const cookie = await sessionCookieFor(admin.id);
    const res = await createRunRoute(apiRequest("/api/v1/runs", { json: {}, cookie, origin: "https://evil.example" }), params({}));
    expect(res.status).toBe(403);
  });

  it("returns 400 for a malformed id instead of a server error", async () => {
    const cookie = await sessionCookieFor(analyst.id);
    const res = await transitionRoute(
      apiRequest("/api/v1/exceptions/not-a-uuid/transition", { json: { action: "start_review", version: 1 }, cookie }),
      params({ id: "not-a-uuid" }),
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it("exports exceptions as CSV with formula-safe cells", async () => {
    const cookie = await sessionCookieFor(viewer.id);
    const res = await exportRoute(apiRequest(`/api/v1/exceptions/export?runId=${runId}`, { cookie }), params({}));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/csv/);
    const text = await res.text();
    expect(text.split("\n").length).toBeGreaterThan(10);
  });
});

describe("participant file upload", () => {
  const csv = (ref: string) => CSV_HEADER_LINE + `${ref},,PAYMENT,UPI,250.00,INR,SUCCESS,CUST9,MER9,HDFC,ICIC,2026-10-28T10:00:00+05:30\r\n`;
  const upload = (cookie: string, content: string, name = "issuer.csv") => {
    const form = new FormData();
    form.set("source", "ISSUER");
    form.set("businessDate", "2026-10-28");
    form.set("file", new File([content], name, { type: "text/csv" }));
    return uploadRoute(apiRequest("/api/v1/files", { body: form, method: "POST", cookie }), params({}));
  };

  it("imports a valid file and rejects the exact same file again", async () => {
    const cookie = await sessionCookieFor(analyst.id);
    const first = await upload(cookie, csv("UP0000000001"));
    expect(first.status).toBe(201);
    expect((await first.json()).rowCount).toBe(1);
    const again = await upload(cookie, csv("UP0000000001"));
    expect(again.status).toBe(409);
  });

  it("rejects an invalid file atomically with row errors", async () => {
    const cookie = await sessionCookieFor(analyst.id);
    const res = await upload(cookie, csv("UP0000000002").replace("250.00", "abc"));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(JSON.stringify(body)).toMatch(/amount/);
  });

  it("rejects non-CSV files", async () => {
    const cookie = await sessionCookieFor(analyst.id);
    const res = await upload(cookie, "hello", "malware.exe");
    expect(res.status).toBe(400);
  });

  it("forbids viewers from uploading", async () => {
    const cookie = await sessionCookieFor(viewer.id);
    expect((await upload(cookie, csv("UP0000000003"))).status).toBe(403);
  });
});
