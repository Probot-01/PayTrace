import { NextResponse } from "next/server";
import { publicRoute } from "@/server/http";
import { audit } from "@/server/audit";
import { SESSION_COOKIE, invalidateSession, validateSessionToken } from "@/server/auth/session";

export const POST = publicRoute(async (req, { ip }) => {
  const session = await validateSessionToken(req.cookies.get(SESSION_COOKIE())?.value);
  if (session) {
    await invalidateSession(session.sessionId);
    await audit({ id: session.user.id, email: session.user.email, ip }, "auth.logout", "user", session.user.id);
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE(), "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 });
  return res;
});

