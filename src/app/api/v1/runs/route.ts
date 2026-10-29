import { NextResponse } from "next/server";
import { apiRoute, readJson } from "@/server/http";
import { createRun, createRunSchema } from "@/server/services/runs";

export const POST = apiRoute({ permission: "runs:create" }, async (req, ctx) => {
  const input = await readJson(req, createRunSchema);
  const run = await createRun(ctx.actor, input);
  return NextResponse.json({ id: run.id }, { status: 202 });
});
