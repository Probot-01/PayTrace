import { NextResponse } from "next/server";
import { readJson, publicRoute } from "@/server/http";
import { loginSchema, login } from "@/server/services/auth";
import { SESSION_COOKIE, sessionCookieOptions } from "@/server/auth/session";

export const POST = publicRoute(async (req, { ip }) => {
  const input = await readJson(req, loginSchema);
  const result = await login(input, { ip, userAgent: req.headers.get("user-agent") });
  const res = NextResponse.json({ user: result.user });
  res.cookies.set(SESSION_COOKIE(), result.token, sessionCookieOptions(result.expiresAt));
  return res;
});
