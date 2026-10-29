import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/** Liveness + readiness: 200 when the database answers, 503 otherwise. No internals are exposed. */
export async function GET() {
  const started = Date.now();
  try {
    await getDb().execute(sql`select 1`);
    return NextResponse.json({ status: "ok", db: "ok", latencyMs: Date.now() - started }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, "health check failed");
    return NextResponse.json({ status: "degraded", db: "unreachable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
