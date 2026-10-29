import { NextResponse } from "next/server";
import { apiRoute, readJson } from "@/server/http";
import { changePassword, changePasswordSchema } from "@/server/services/auth";

export const POST = apiRoute({ permission: "dashboard:view" }, async (req, ctx) => {
  const input = await readJson(req, changePasswordSchema);
  await changePassword(ctx.user.id, ctx.sessionId, input, ctx.ip);
  return NextResponse.json({ ok: true });
});
