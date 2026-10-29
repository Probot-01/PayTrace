import { NextResponse } from "next/server";
import { z } from "zod";
import { apiRoute, readJson } from "@/server/http";
import { updateUser, updateUserSchema } from "@/server/services/users";

export const PATCH = apiRoute({ permission: "users:manage" }, async (req, ctx, params) => {
  const input = await readJson(req, updateUserSchema);
  const user = await updateUser(ctx.actor, z.uuid().parse(params.id), input);
  return NextResponse.json({ user });
});
