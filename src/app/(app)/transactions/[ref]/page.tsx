import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AccessDenied, Card, EmptyState, PageHeader, SeverityBadge, StatusBadge, cx } from "@/components/ui";
import { FAULT_LABELS, type InjectedFault, type TimelineEvent } from "@/domain/simulator/simulate";
import { CATEGORY_LABELS, SOURCE_SHORT_LABELS } from "@/domain/types";
import { formatBusinessDate, formatDateTime, formatTime } from "@/lib/format";
import { formatINR } from "@/lib/money";
import { requirePage } from "@/server/auth/current";
import { traceTransaction } from "@/server/services/runs";
import { getSimTransaction } from "@/server/services/simulations";

export const metadata: Metadata = { title: "Trace" };

export default async function TracePage({ params }: { params: Promise<{ ref: string }> }) {
  const { allowed } = await requirePage("runs:view");
  if (!allowed) return <AccessDenied />;
  const ref = decodeURIComponent((await params).ref);
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(ref)) notFound();
  const [trace, sim] = await Promise.all([traceTransaction(ref), getSimTransaction(ref)]);
  const empty = !trace.records.length && !sim;

  return (
    <>
      <PageHeader breadcrumb={[{ href: "/transactions", label: "Transaction trace" }]} title={ref} description="Every record that carries this reference, from every participant file, and every run's verdict." />
      {empty ? (
        <EmptyState title="Reference not found">No participant file contains {ref}. Check the reference, or upload the file it should be in.</EmptyState>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <Card title="Participant records" id="records">
              <div className="-mx-4 -mb-4 overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">Time</th>
                      <th scope="col">Participant</th>
                      <th scope="col">Type</th>
                      <th scope="col">Status</th>
                      <th scope="col" className="num">Amount</th>
                      <th scope="col">File</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trace.records.map(({ record: r, filename, businessDate }) => (
                      <tr key={r.id}>
                        <td className="whitespace-nowrap">{formatDateTime(r.eventAt)}</td>
                        <td>{SOURCE_SHORT_LABELS[r.source]}</td>
                        <td>
                          {r.recordType.toLowerCase()}
                          {r.txnRef !== ref ? <div className="mono text-xs text-ink-3">{r.txnRef}</div> : null}
                        </td>
                        <td>
                          {r.status.toLowerCase()} <span className="text-ink-3">({r.rawStatus})</span>
                        </td>
                        <td className="num">{formatINR(r.amountPaise)}</td>
                        <td className="text-xs">
                          <Link href={`/files/${r.fileId}`} className="text-accent hover:underline">
                            {filename}
                          </Link>
                          <div className="text-ink-3">{formatBusinessDate(businessDate)}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
            {sim ? (
              <Card title="Simulated switch timeline" description={`Ground truth from “${sim.simName}”.`} id="timeline">
                <p className="mb-3 text-sm">
                  Injected: <strong>{FAULT_LABELS[sim.tx.injectedFault as InjectedFault] ?? sim.tx.injectedFault}</strong> · switch {sim.tx.switchStatus.toLowerCase()} · bank {sim.tx.bankStatus.toLowerCase()} · merchant {sim.tx.merchantStatus.toLowerCase()} · settlement {sim.tx.settlementStatus.toLowerCase().replace("_", " ")} · refund {sim.tx.refundStatus.toLowerCase()}
                </p>
                <ol className="space-y-1 border-l border-line pl-4 text-sm">
                  {(sim.tx.timeline as TimelineEvent[]).map((t, i) => (
                    <li key={i} className="relative">
                      <span aria-hidden className={cx("absolute -left-[21px] top-1.5 h-2 w-2 rounded-full", t.status === "OK" ? "bg-good" : t.status === "PENDING" ? "bg-warning" : "bg-critical")} />
                      <span className="mono text-xs text-ink-3">{formatTime(t.at)}</span> <span className="font-medium">{t.stage.replaceAll("_", " ").toLowerCase()}</span> · {t.status.toLowerCase()} <span className="text-ink-3">(+{t.latencyMs.toLocaleString("en-IN")} ms)</span>
                      {t.note ? <span className="text-ink-2"> · {t.note}</span> : null}
                    </li>
                  ))}
                </ol>
              </Card>
            ) : null}
          </div>
          <div className="space-y-4">
            <Card title="Reconciliation verdicts" id="verdicts">
              {trace.results.length ? (
                <ul className="space-y-2 text-sm">
                  {trace.results.map((r) => (
                    <li key={r.id}>
                      <Link href={`/runs/${r.runId}`} className="text-accent hover:underline">
                        Run {r.runId.slice(0, 8)}
                      </Link>
                      : {r.matched ? <span className="text-good">matched</span> : <span className="text-critical">{r.exceptionCount} exception(s)</span>} · {r.outcome.toLowerCase()}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-ink-2">Not reconciled yet.</p>
              )}
            </Card>
            <Card title="Exceptions" id="exceptions">
              {trace.exceptions.length ? (
                <ul className="space-y-3 text-sm">
                  {trace.exceptions.map((e) => (
                    <li key={e.id}>
                      <Link href={`/exceptions/${e.id}`} className="font-medium text-accent hover:underline">
                        {CATEGORY_LABELS[e.category]}
                      </Link>
                      <div className="mt-1 flex gap-2">
                        <SeverityBadge severity={e.severity} />
                        <StatusBadge status={e.status} />
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-ink-2">None.</p>
              )}
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
