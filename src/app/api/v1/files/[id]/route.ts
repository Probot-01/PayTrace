import { NextResponse } from "next/server";
import { z } from "zod";
import { apiRoute } from "@/server/http";
import { deleteFile } from "@/server/services/files";

export const DELETE = apiRoute({ permission: "files:delete" }, async (_req, ctx, params) => {
  await deleteFile(ctx.actor, z.uuid().parse(params.id));
  return NextResponse.json({ ok: true });
});
