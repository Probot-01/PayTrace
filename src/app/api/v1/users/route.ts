import { NextResponse } from "next/server";
import { apiRoute, readJson } from "@/server/http";
import { createUser, createUserSchema } from "@/server/services/users";

export const POST = apiRoute({ permission: "users:manage" }, async (req, ctx) => {
  const input = await readJson(req, createUserSchema);
  const result = await createUser(ctx.actor, input);
  return NextResponse.json(result, { status: 201 });
});
