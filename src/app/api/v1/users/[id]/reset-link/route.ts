import { NextResponse } from "next/server";
import { z } from "zod";
import { apiRoute } from "@/server/http";
import { issueUserResetLink } from "@/server/services/users";

export const POST = apiRoute({ permission: "users:manage" }, async (_req, ctx, params) => {
  const result = await issueUserResetLink(ctx.actor, z.uuid().parse(params.id));
  return NextResponse.json(result);
});
