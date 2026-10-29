import { NextResponse } from "next/server";
import { z } from "zod";
import { apiRoute } from "@/server/http";
import { deleteRun, getRun } from "@/server/services/runs";

export const GET = apiRoute({ permission: "runs:view" }, async (_req, _ctx, params) => {
  const run = await getRun(z.uuid().parse(params.id));
  return NextResponse.json({ status: run.status, error: run.error });
});

export const DELETE = apiRoute({ permission: "runs:delete" }, async (_req, ctx, params) => {
  await deleteRun(ctx.actor, z.uuid().parse(params.id));
  return NextResponse.json({ ok: true });
});
