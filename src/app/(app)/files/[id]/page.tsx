import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ConfirmAction } from "@/components/client/confirm-action";
import { AccessDenied, Card, PageHeader, Pagination, buttonStyles } from "@/components/ui";
import { SOURCE_LABELS } from "@/domain/types";
import { isAppError } from "@/lib/errors";
import { formatBusinessDate, formatBytes, formatDateTime } from "@/lib/format";
import { formatCount, formatINR } from "@/lib/money";
import { requirePage } from "@/server/auth/current";
import { can } from "@/server/auth/permissions";
import { getFile, getFileRecords } from "@/server/services/files";

export const metadata: Metadata = { title: "Participant file" };

export default async function FilePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ page?: string }> }) {
  const { user, allowed } = await requirePage("files:view");
  if (!allowed) return <AccessDenied />;
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const page = Math.min(Math.max(1, Number((await searchParams).page) || 1), 10_000);
  let file;
  try {
    file = await getFile(id);
  } catch (err) {
    if (isAppError(err) && err.status === 404) notFound();
    throw err;
  }
  const records = await getFileRecords(id, page);

  return (
    <>
      <PageHeader
        breadcrumb={[{ href: "/files", label: "Participant files" }]}
        title={file.filename}
        description={`${SOURCE_LABELS[file.source]} · business date ${formatBusinessDate(file.businessDate)} · ${formatCount(file.rowCount)} rows · ${formatBytes(file.sizeBytes)} · ${file.origin === "SIMULATOR" ? "simulated" : "uploaded"} ${formatDateTime(file.createdAt)}`}
        actions={
          <>
            <a href={`/api/v1/files/${id}/download`} className={buttonStyles.secondary} download>
              Download CSV
            </a>
            {file.simulationId ? (
              <Link href={`/simulator/${file.simulationId}`} className={buttonStyles.ghost}>
                Simulation
              </Link>
            ) : null}
            {can(user.role, "files:delete") ? (
              <ConfirmAction
                label="Delete"
                title="Delete this file?"
                body={`All ${formatCount(file.rowCount)} records from this file will be removed. Files used by a reconciliation run cannot be deleted until the run is deleted.`}
                confirmLabel="Delete file"
                url={`/api/v1/files/${id}`}
                redirectTo="/files"
              />
            ) : null}
          </>
        }
      />
      <Card title="Records" description={`SHA-256 ${file.sha256.slice(0, 16)}…`}>
        <div className="-mx-4 -mb-4 overflow-x-auto" tabIndex={0} role="region" aria-label="Scrollable table">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col" className="num">
                  Line
                </th>
                <th scope="col">Reference</th>
                <th scope="col">Type</th>
                <th scope="col">Method</th>
                <th scope="col" className="num">
                  Amount
                </th>
                <th scope="col">Status</th>
                <th scope="col">Customer</th>
                <th scope="col">Merchant</th>
                <th scope="col">Banks</th>
                <th scope="col">Time</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.id}>
                  <td className="num text-ink-3">{r.lineNo}</td>
                  <td>
                    <Link href={`/transactions/${encodeURIComponent(r.txnRef)}`} className="mono text-accent hover:underline">
                      {r.txnRef}
                    </Link>
                    {r.parentRef ? <div className="mono text-xs text-ink-3">↳ {r.parentRef}</div> : null}
                  </td>
                  <td>{r.recordType.toLowerCase()}</td>
                  <td>{r.method}</td>
                  <td className="num">{formatINR(r.amountPaise)}</td>
                  <td>
                    {r.status.toLowerCase()}
                    {r.rawStatus !== r.status ? <span className="text-ink-3"> ({r.rawStatus})</span> : null}
                  </td>
                  <td className="mono text-xs">{r.customerId ?? "—"}</td>
                  <td className="mono text-xs">{r.merchantId ?? "—"}</td>
                  <td className="text-xs">
                    {r.issuingBank ?? "—"} → {r.acquiringBank ?? "—"}
                  </td>
                  <td className="whitespace-nowrap text-xs">{formatDateTime(r.eventAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Pagination page={page} pageSize={50} total={file.rowCount} hrefFor={(p) => `?page=${p}`} />
    </>
  );
}
