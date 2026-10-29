import { NextResponse } from "next/server";
import { publicRoute, readJson } from "@/server/http";
import { resetPassword, resetSchema } from "@/server/services/auth";
import { hitRateLimit } from "@/server/rate-limit";
import { tooManyRequests } from "@/lib/errors";

export const POST = publicRoute(async (req, { ip }) => {
  if (ip) {
    const limit = await hitRateLimit(`reset-submit-ip:${ip}`, 20, 60 * 60);
    if (!limit.allowed) throw tooManyRequests(limit.retryAfterSeconds);
  }
  const input = await readJson(req, resetSchema);
  await resetPassword(input, ip);
  return NextResponse.json({ ok: true });
});
