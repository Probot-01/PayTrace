import { NextResponse } from "next/server";
import { z } from "zod";
import { apiRoute } from "@/server/http";
import { deleteSimulation, getSimulation } from "@/server/services/simulations";

export const GET = apiRoute({ permission: "simulations:view" }, async (_req, _ctx, params) => {
  const { sim } = await getSimulation(z.uuid().parse(params.id));
  return NextResponse.json({ status: sim.status, error: sim.error });
});

export const DELETE = apiRoute({ permission: "simulations:delete" }, async (_req, ctx, params) => {
  await deleteSimulation(ctx.actor, z.uuid().parse(params.id));
  return NextResponse.json({ ok: true });
});
