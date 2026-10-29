import { NextResponse } from "next/server";
import { z } from "zod";
import { apiRoute, readJson } from "@/server/http";
import { commentOnException, commentSchema } from "@/server/services/exceptions";

export const POST = apiRoute({ permission: "exceptions:work" }, async (req, ctx, params) => {
  const id = z.uuid().parse(params.id);
  const input = await readJson(req, commentSchema);
  const row = await commentOnException({ ...ctx.actor, id: ctx.user.id, role: ctx.user.role }, id, input);
  return NextResponse.json({ id: row.id }, { status: 201 });
});
