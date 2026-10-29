import type { Metadata } from "next";
import Link from "next/link";
import { AccessDenied, ButtonLink, EmptyState, JobStatusBadge, PageHeader, Pagination } from "@/components/ui";
import { formatBusinessDate, formatDateTime } from "@/lib/format";
import { formatCount, formatINRCompact, formatPercent } from "@/lib/money";
import { requirePage } from "@/server/auth/current";
import { can } from "@/server/auth/permissions";
import { listRuns, runListSchema } from "@/server/services/runs";

export const metadata: Metadata = { title: "Reconciliation runs" };

export default async function RunsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const { user, allowed } = await requirePage("runs:view");
  if (!allowed) return <AccessDenied />;
  const q = runListSchema.safeParse(await searchParams);
  const { page, pageSize } = q.success ? q.data : { page: 1, pageSize: 25 };
  const { rows, total } = await listRuns(page, pageSize);
  return (
    <>
      <PageHeader
        title="Reconciliation runs"
        description="Each run compares the selected participant files for one business date and records every match and exception."
        actions={can(user.role, "runs:create") ? <ButtonLink href="/runs/new" variant="primary">New run</ButtonLink> : null}
      />
      {rows.length === 0 ? (
        <EmptyState title="No runs yet" action={can(user.role, "runs:create") ? <ButtonLink href="/runs/new" variant="primary">Start a run</ButtonLink> : null}>
          A run needs files from at least two participants for the same business date.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Business date</th>
                <th scope="col">Status</th>
                <th scope="col" className="num">Transactions</th>
                <th scope="col" className="num">Reconciled</th>
                <th scope="col" className="num">Exceptions</th>
                <th scope="col" className="num">Value affected</th>
                <th scope="col">Started</th>
                <th scope="col">By</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/runs/${r.id}`} className="font-medium text-accent hover:underline">
                      {formatBusinessDate(r.businessDate)}
                    </Link>
                  </td>
                  <td><JobStatusBadge status={r.status} /></td>
                  <td className="num">{r.status === "COMPLETED" ? formatCount(r.totalTransactions) : "—"}</td>
                  <td className="num">{r.status === "COMPLETED" ? formatPercent(r.totalTransactions ? r.matchedTransactions / r.totalTransactions : 0) : "—"}</td>
                  <td className="num">{r.status === "COMPLETED" ? formatCount(r.exceptionCount) : "—"}</td>
                  <td className="num">{r.status === "COMPLETED" ? formatINRCompact(r.affectedValuePaise) : "—"}</td>
                  <td className="whitespace-nowrap text-ink-2">{formatDateTime(r.createdAt)}</td>
                  <td className="text-ink-2">{r.createdByName ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={page} pageSize={pageSize} total={total} hrefFor={(p) => `?page=${p}`} />
    </>
  );
}
