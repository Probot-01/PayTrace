import { NextResponse } from "next/server";
import { z } from "zod";
import { publicRoute, readJson } from "@/server/http";
import { requestPasswordReset } from "@/server/services/auth";
import { hitRateLimit } from "@/server/rate-limit";
import { tooManyRequests } from "@/lib/errors";

const schema = z.object({ email: z.string().trim().email("Enter a valid email address.").max(254) });

export const POST = publicRoute(async (req, { ip }) => {
  if (ip) {
    const limit = await hitRateLimit(`reset-ip:${ip}`, 10, 60 * 60);
    if (!limit.allowed) throw tooManyRequests(limit.retryAfterSeconds);
  }
  const { email } = await readJson(req, schema);
  await requestPasswordReset(email, ip);
  // Same response whether or not the account exists.
  return NextResponse.json({ ok: true });
});
