import { NextResponse } from "next/server";
import { apiRoute, readJson } from "@/server/http";
import { settingsSchema, updateSettings } from "@/server/services/settings";

export const PUT = apiRoute({ permission: "settings:manage" }, async (req, ctx) => {
  const input = await readJson(req, settingsSchema);
  return NextResponse.json({ settings: await updateSettings(ctx.actor, input) });
});
