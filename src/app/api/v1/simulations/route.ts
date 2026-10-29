import { NextResponse } from "next/server";
import { apiRoute, readJson } from "@/server/http";
import { createSimulation, createSimulationSchema } from "@/server/services/simulations";

export const POST = apiRoute({ permission: "simulations:create" }, async (req, ctx) => {
  const input = await readJson(req, createSimulationSchema);
  const sim = await createSimulation(ctx.actor, input);
  return NextResponse.json({ id: sim.id }, { status: 202 });
});
