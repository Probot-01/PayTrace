import type { Metadata } from "next";
import Link from "next/link";
import { AccessDenied, Card, EmptyState, PageHeader, Pagination, buttonStyles } from "@/components/ui";
import { CSV_COLUMNS } from "@/domain/ingest/csv-format";
import { SOURCE_LABELS, SOURCE_SHORT_LABELS, SOURCE_SYSTEMS } from "@/domain/types";
import { formatBusinessDate, formatBytes, formatDateTime, todayIst } from "@/lib/format";
import { formatCount } from "@/lib/money";
import { requirePage } from "@/server/auth/current";
import { can } from "@/server/auth/permissions";
import { fileListSchema, listFiles } from "@/server/services/files";
import { UploadForm } from "./upload-form";

export const metadata: Metadata = { title: "Participant files" };

export default async function FilesPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const { user, allowed } = await requirePage("files:view");
  if (!allowed) return <AccessDenied />;
  const raw = await searchParams;
  const parsed = fileListSchema.safeParse(raw);
  const filter = parsed.success ? parsed.data : fileListSchema.parse({});
  const { rows, total } = await listFiles(filter);
  const qs = (page: number) => {
    const p = new URLSearchParams(Object.entries(raw).filter(([, v]) => v));
    p.set("page", String(page));
    return `?${p}`;
  };

  return (
    <>
      <PageHeader title="Participant files" description="Transaction records from each participant in the payment chain. Each file is validated row by row and stored once (duplicates are rejected by checksum)." />
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <form method="get" className="flex flex-wrap items-end gap-2" aria-label="Filter files">
            <label className="text-sm">
              <span className="mb-1 block text-xs font-medium text-ink-3">Participant</span>
              <select name="source" defaultValue={filter.source ?? ""} className="rounded-md border border-line-strong bg-surface px-2 py-2 text-sm">
                <option value="">All</option>
                {SOURCE_SYSTEMS.map((s) => (
                  <option key={s} value={s}>
                    {SOURCE_SHORT_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs font-medium text-ink-3">Business date</span>
              <input type="date" name="businessDate" defaultValue={filter.businessDate ?? ""} className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs font-medium text-ink-3">Origin</span>
              <select name="origin" defaultValue={filter.origin ?? ""} className="rounded-md border border-line-strong bg-surface px-2 py-2 text-sm">
                <option value="">Any</option>
                <option value="UPLOAD">Uploaded</option>
                <option value="SIMULATOR">Simulated</option>
              </select>
            </label>
            <button className={buttonStyles.secondary}>Filter</button>
          </form>
          {rows.length === 0 ? (
            <EmptyState title="No files found">{total === 0 && !raw.source && !raw.businessDate ? "Upload a participant file or generate a simulated day to begin." : "No files match these filters."}</EmptyState>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-line bg-surface">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">File</th>
                    <th scope="col">Participant</th>
                    <th scope="col">Business date</th>
                    <th scope="col" className="num">Rows</th>
                    <th scope="col">Origin</th>
                    <th scope="col">Added</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((f) => (
                    <tr key={f.id}>
                      <td>
                        <Link href={`/files/${f.id}`} className="font-medium text-accent hover:underline">
                          {f.filename}
                        </Link>
                        <div className="text-xs text-ink-3">
                          {formatBytes(f.sizeBytes)}
                          {f.runCount ? ` · used in ${f.runCount} run${f.runCount === 1 ? "" : "s"}` : ""}
                        </div>
                      </td>
                      <td>{SOURCE_SHORT_LABELS[f.source]}</td>
                      <td className="whitespace-nowrap">{formatBusinessDate(f.businessDate)}</td>
                      <td className="num">{formatCount(f.rowCount)}</td>
                      <td>{f.origin === "SIMULATOR" ? "Simulated" : "Uploaded"}</td>
                      <td className="whitespace-nowrap text-ink-2">{formatDateTime(f.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pagination page={filter.page} pageSize={filter.pageSize} total={total} hrefFor={qs} />
        </div>
        <div className="space-y-4">
          {can(user.role, "files:upload") ? (
            <Card title="Upload a file" id="upload">
              <UploadForm defaultDate={todayIst()} />
            </Card>
          ) : null}
          <Card title="File format" id="format" description="One layout for every participant.">
            <ul className="space-y-1 text-xs text-ink-2">
              {CSV_COLUMNS.map((c) => (
                <li key={c} className="mono">
                  {c}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-ink-3">
              Status accepts common codes (SUCCESS/S/00/SETTLED, FAILED/F/DECLINED, PENDING/DEEMED/TIMEOUT, REVERSED). Amounts are rupees with up to two decimals; timestamps need a timezone offset. Refund and reversal rows must name the original reference in <span className="mono">parent_ref</span>.
            </p>
            <p className="mt-2 text-xs text-ink-3">Participants: {SOURCE_SYSTEMS.map((s) => SOURCE_LABELS[s]).join(", ")}.</p>
          </Card>
        </div>
      </div>
    </>
  );
}
