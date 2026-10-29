import { NextResponse } from "next/server";
import { badRequest } from "@/lib/errors";
import { MAX_UPLOAD_BYTES } from "@/domain/ingest/csv-format";
import { apiRoute } from "@/server/http";
import { uploadMetaSchema, uploadParticipantFile } from "@/server/services/files";

export const POST = apiRoute({ permission: "files:upload" }, async (req, ctx) => {
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_UPLOAD_BYTES + 64 * 1024) throw badRequest(`The file is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`);
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw badRequest("Send the file as multipart/form-data.");
  }
  const meta = uploadMetaSchema.parse({ source: form.get("source"), businessDate: form.get("businessDate") });
  const file = form.get("file");
  if (!(file instanceof File)) throw badRequest("Choose a CSV file to upload.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const created = await uploadParticipantFile(ctx.actor, meta, { name: file.name, type: file.type, bytes });
  return NextResponse.json({ id: created.id, rowCount: created.rowCount }, { status: 201 });
});
