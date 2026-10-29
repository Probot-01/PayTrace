import { NextResponse } from "next/server";
import { z } from "zod";
import { apiRoute, readJson } from "@/server/http";
import { transitionException, transitionSchema } from "@/server/services/exceptions";

export const POST = apiRoute({ permission: "exceptions:work" }, async (req, ctx, params) => {
  const id = z.uuid().parse(params.id);
  const input = await readJson(req, transitionSchema);
  const updated = await transitionException({ ...ctx.actor, id: ctx.user.id, role: ctx.user.role }, id, input);
  return NextResponse.json({ status: updated.status, version: updated.version });
});
