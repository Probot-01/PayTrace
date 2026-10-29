import { z } from "zod";
import { apiRoute } from "@/server/http";
import { fileAsCsv, getFile } from "@/server/services/files";

export const GET = apiRoute({ permission: "files:view" }, async (_req, _ctx, params) => {
  const file = await getFile(z.uuid().parse(params.id));
  const iterator = fileAsCsv(file.id);
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await iterator.next();
      if (done) controller.close();
      else controller.enqueue(encoder.encode(value));
    },
  });
  const name = file.filename.replace(/[^\w.\-]+/g, "_");
  return new Response(stream, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"` },
  });
});
