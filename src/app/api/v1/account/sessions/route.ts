import { NextResponse } from "next/server";
import { z } from "zod";
import { apiRoute, readJson } from "@/server/http";
import { revokeOwnSession } from "@/server/services/users";

const schema = z.object({ sessionId: z.string().regex(/^[a-f0-9]{64}$/) });

export const DELETE = apiRoute({ permission: "dashboard:view" }, async (req, ctx) => {
  const { sessionId } = await readJson(req, schema);
  await revokeOwnSession({ ...ctx.actor, id: ctx.user.id }, sessionId);
  return NextResponse.json({ ok: true });
});
