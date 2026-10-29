import { CSV_HEADER_LINE } from "@/domain/ingest/csv-format";
import { apiRoute } from "@/server/http";

const EXAMPLE =
  CSV_HEADER_LINE +
  "630214000123,,PAYMENT,UPI,1499.00,INR,SUCCESS,CUST0000123,MER000042,HDFC,ICIC,2026-10-28T14:05:12+05:30\r\n" +
  "RF26301000000045,630214000123,REFUND,UPI,499.00,INR,SUCCESS,CUST0000123,MER000042,HDFC,ICIC,2026-10-28T16:40:00+05:30\r\n" +
  "SBINN6301000123,,PAYMENT,NEFT,250000.00,INR,PENDING,CUST0000456,MER000007,SBIN,UTIB,2026-10-28T11:00:00+05:30\r\n";

export const GET = apiRoute({ permission: "files:view" }, async () => {
  return new Response(EXAMPLE, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="paytrace-participant-template.csv"' },
  });
});
