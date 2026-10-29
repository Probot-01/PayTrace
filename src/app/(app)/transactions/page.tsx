import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AccessDenied, EmptyState, MethodTag, PageHeader, Pagination, buttonStyles } from "@/components/ui";
import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS, SOURCE_SHORT_LABELS, SOURCE_SYSTEMS, type SourceSystem } from "@/domain/types";
import { formatBusinessDate, formatDateTime } from "@/lib/format";
import { formatCount, formatINR } from "@/lib/money";
import { requirePage } from "@/server/auth/current";
import { completedRunOptions } from "@/server/services/dashboard";
import { listReconTransactions, txnListSchema } from "@/server/services/runs";

export const metadata: Metadata = { title: "Transaction trace" };

const sel = "rounded-md border border-line-strong bg-surface px-2 py-2 text-sm";

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const { allowed } = await requirePage("runs:view");
  if (!allowed) return <AccessDenied />;
  const raw = await searchParams;
  // An exact reference search jumps straight to the trace.
  if (raw.trace?.trim()) redirect(`/transactions/${encodeURIComponent(raw.trace.trim().slice(0, 40))}`);
  const runs = await completedRunOptions();
  const parsed = txnListSchema.safeParse({ ...raw, runId: raw.runId || runs[0]?.id });
  const filter = parsed.success ? parsed.data : txnListSchema.parse({ runId: runs[0]?.id });
  const { rows, total } = runs.length ? await listReconTransactions(filter) : { rows: [], total: 0 };
  const qs = (page: number) => {
    const p = new URLSearchParams(Object.entries(raw).filter(([, v]) => v));
    p.set("page", String(page));
    return `?${p}`;
  };

  return (
    <>
      <PageHeader title="Transaction trace" description="Follow a single payment across every participant, or browse a run's verdict on each transaction." />
      <form method="get" className="mb-4 flex flex-wrap items-end gap-2" role="search">
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-ink-3">Trace a reference (RRN / UTR)</span>
          <input name="trace" className={`${sel} w-64`} placeholder="Exact reference" maxLength={40} />
        </label>
        <button className={buttonStyles.primary}>Trace</button>
      </form>
      {runs.length === 0 ? (
        <EmptyState title="No completed runs">Run a reconciliation to browse per-transaction results.</EmptyState>
      ) : (
        <>
          <form method="get" className="mb-3 flex flex-wrap items-end gap-2" aria-label="Filter transactions">
            <label className="text-sm">
              <span className="mb-1 block text-xs font-medium text-ink-3">Run</span>
              <select name="runId" defaultValue={filter.runId} className={sel}>
                {runs.map((r) => (
                  <option key={r.id} value={r.id}>
                    {formatBusinessDate(r.businessDate)} · {formatDateTime(r.createdAt)}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs font-medium text-ink-3">Reference starts with</span>
              <input name="q" defaultValue={filter.q ?? ""} className={sel} maxLength={40} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs font-medium text-ink-3">Outcome</span>
              <select name="outcome" defaultValue={filter.outcome ?? ""} className={sel}>
                <option value="">Any</option>
                <option value="SUCCESS">Successful</option>
                <option value="FAILED">Failed</option>
                <option value="PENDING">Pending</option>
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs font-medium text-ink-3">Reconciled</span>
              <select name="matched" defaultValue={filter.matched ?? ""} className={sel}>
                <option value="">Any</option>
                <option value="yes">Matched</option>
                <option value="no">Has exceptions</option>
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs font-medium text-ink-3">Method</span>
              <select name="method" defaultValue={filter.method ?? ""} className={sel}>
                <option value="">All</option>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {PAYMENT_METHOD_LABELS[m]}
                  </option>
                ))}
              </select>
            </label>
            <button className={buttonStyles.secondary}>Filter</button>
          </form>
          <p className="mb-2 text-sm text-ink-2" role="status">
            {formatCount(total)} transaction{total === 1 ? "" : "s"}
          </p>
          {rows.length === 0 ? (
            <EmptyState title="No transactions match">Try other filters.</EmptyState>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-line bg-surface">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Reference</th>
                    <th scope="col">Method</th>
                    <th scope="col" className="num">Amount</th>
                    <th scope="col">Outcome</th>
                    <th scope="col">Seen by</th>
                    <th scope="col">Reconciled</th>
                    <th scope="col">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((t) => (
                    <tr key={t.id}>
                      <td>
                        <Link href={`/transactions/${encodeURIComponent(t.txnRef)}`} className="mono text-accent hover:underline">
                          {t.txnRef}
                        </Link>
                        {t.isRefund ? <span className="ml-1 text-xs text-ink-3">refund</span> : null}
                      </td>
                      <td>
                        <MethodTag method={t.method} />
                      </td>
                      <td className="num">{formatINR(t.amountPaise)}</td>
                      <td>{t.outcome.charAt(0) + t.outcome.slice(1).toLowerCase()}</td>
                      <td className="text-xs text-ink-2">
                        {SOURCE_SYSTEMS.map((s) => (
                          <span key={s} className={(t.sourcesPresent as SourceSystem[]).includes(s) ? "mr-1.5" : "mr-1.5 text-ink-3 line-through"} title={(t.sourcesPresent as SourceSystem[]).includes(s) ? "Record present" : "No record"}>
                            {SOURCE_SHORT_LABELS[s]}
                          </span>
                        ))}
                      </td>
                      <td>{t.matched ? <span className="text-good">✓ Matched</span> : <span className="text-critical">✕ {t.exceptionCount} exception{t.exceptionCount === 1 ? "" : "s"}</span>}</td>
                      <td className="whitespace-nowrap text-xs text-ink-2">{formatDateTime(t.txnAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pagination page={filter.page} pageSize={filter.pageSize} total={total} hrefFor={qs} />
        </>
      )}
    </>
  );
}
