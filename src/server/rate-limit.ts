import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { rateLimits } from "@/db/schema";

/**
 * Fixed-window rate limiter stored in Postgres so limits hold across multiple app instances.
 * The upsert is a single atomic statement, so concurrent requests cannot both slip through.
 */
export async function hitRateLimit(key: string, limit: number, windowSeconds: number) {
  const rows = await getDb()
    .insert(rateLimits)
    .values({ key, count: 1, windowStart: new Date() })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`case when ${rateLimits.windowStart} < now() - make_interval(secs => ${windowSeconds}) then 1 else ${rateLimits.count} + 1 end`,
        windowStart: sql`case when ${rateLimits.windowStart} < now() - make_interval(secs => ${windowSeconds}) then now() else ${rateLimits.windowStart} end`,
      },
    })
    .returning({ count: rateLimits.count, windowStart: rateLimits.windowStart });
  const { count, windowStart } = rows[0];
  const retryAfterSeconds = Math.max(1, Math.ceil((windowStart.getTime() + windowSeconds * 1000 - Date.now()) / 1000));
  return { allowed: count <= limit, remaining: Math.max(0, limit - count), retryAfterSeconds };
}

export async function clearRateLimit(key: string) {
  await getDb().delete(rateLimits).where(sql`${rateLimits.key} = ${key}`);
}
