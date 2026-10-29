import { NextResponse } from "next/server";
import { z } from "zod";
import { apiRoute, readJson } from "@/server/http";
import { assignException, assignSchema } from "@/server/services/exceptions";

export const POST = apiRoute({ permission: "exceptions:work" }, async (req, ctx, params) => {
  const id = z.uuid().parse(params.id);
  const input = await readJson(req, assignSchema);
  const updated = await assignException({ ...ctx.actor, id: ctx.user.id, role: ctx.user.role }, id, input);
  return NextResponse.json({ assigneeId: updated.assigneeId, version: updated.version });
});
