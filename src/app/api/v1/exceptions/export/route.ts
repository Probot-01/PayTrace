import { apiRoute, parseQuery } from "@/server/http";
import { exceptionFilterSchema, exportExceptionsCsv } from "@/server/services/exceptions";
import { audit } from "@/server/audit";

export const GET = apiRoute({ permission: "exceptions:export" }, async (req, ctx) => {
  const filter = parseQuery(req, exceptionFilterSchema);
  await audit(ctx.actor, "exception.export", "exception", null, { filter });
  const iterator = exportExceptionsCsv(filter, ctx.user.id);
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await iterator.next();
      if (done) controller.close();
      else controller.enqueue(encoder.encode(value));
    },
  });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="paytrace-exceptions-${stamp}.csv"`,
    },
  });
});
