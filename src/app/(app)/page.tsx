import type { Metadata } from "next";
import Link from "next/link";
import { AutoSubmitSelect } from "@/components/client/auto-submit-select";
import { TrendChart } from "@/components/client/trend-chart";
import { AccessDenied, BarList, ButtonLink, Card, EmptyState, MethodTag, PageHeader, SeverityBadge, StatTile, StatusBadge } from "@/components/ui";
import { CATEGORY_LABELS, EXCEPTION_CATEGORIES, PAYMENT_METHODS, SOURCE_SHORT_LABELS } from "@/domain/types";
import { formatBusinessDate, formatDateTime, relativeDue, shortBusinessDate } from "@/lib/format";
import { formatCount, formatINR, formatINRCompact, formatPercent } from "@/lib/money";
import { requirePage } from "@/server/auth/current";
import { can } from "@/server/auth/permissions";
import { completedRunOptions, portfolio, reconTrend, runDashboard } from "@/server/services/dashboard";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ run?: string }> }) {
  const { user, allowed } = await requirePage("dashboard:view");
  if (!allowed) return <AccessDenied />;
  const params = await searchParams;
  const runs = await completedRunOptions();

  if (runs.length === 0) {
    return (
      <>
        <PageHeader title="Reconciliation overview" />
        <EmptyState
          title="No reconciliation results yet"
          action={
            can(user.role, "simulations:create") ? (
              <div className="flex flex-wrap justify-center gap-2">
                <ButtonLink href="/simulator" variant="primary">
                  Simulate a business day
                </ButtonLink>
                <ButtonLink href="/files">Upload participant files</ButtonLink>
              </div>
            ) : null
          }
        >
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-left">
            <li>Bring in records from each participant: generate a simulated day, or upload the switch, bank, merchant and settlement files.</li>
            <li>Start a reconciliation run for that business date.</li>
            <li>Work the exceptions it finds from the Exceptions queue.</li>
          </ol>
          {!can(user.role, "simulations:create") ? <p className="mt-3">An analyst needs to load data first. You have read-only access.</p> : null}
        </EmptyState>
      </>
    );
  }

  const runId = runs.some((r) => r.id === params.run) ? params.run! : runs[0].id;
  const [data, trend, work] = await Promise.all([runDashboard(runId), reconTrend(), portfolio(user.id)]);
  if (!data) return null;
  const { stats, run } = data;
  const runLink = (extra: string) => `/exceptions?runId=${runId}${extra}`;
  const categories = EXCEPTION_CATEGORIES.map((c) => ({ c, v: stats.byCategory[c] })).filter((x) => x.v && x.v.count > 0);

  return (
    <>
      <PageHeader
        title="Reconciliation overview"
        description={
          <>
            Business date <strong>{formatBusinessDate(run.businessDate)}</strong> · run finished {formatDateTime(run.finishedAt)} ·{" "}
            {formatCount(stats.recordsProcessed)} participant records compared
          </>
        }
        actions={
          <form method="get" className="flex w-full min-w-0 items-end gap-2 sm:w-auto">
            <label className="min-w-0 flex-1 text-sm">
              <span className="mb-1 block text-xs font-medium text-ink-3">Run</span>
              <AutoSubmitSelect
                name="run"
                defaultValue={runId}
                className="w-full max-w-full rounded-md border border-line-strong bg-surface px-2 py-2 text-sm"
              >
                {runs.map((r) => (
                  <option key={r.id} value={r.id}>
                    {formatBusinessDate(r.businessDate)} · {formatCount(r.total)} txns · {formatDateTime(r.createdAt)}
                  </option>
                ))}
              </AutoSubmitSelect>
            </label>
            <noscript>
              <button className="rounded-md border px-3 py-2 text-sm">Show</button>
            </noscript>
          </form>
        }
      />

      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile
          label="Total transactions"
          value={formatCount(stats.totalTransactions)}
          sub={`${formatINRCompact(stats.totalValuePaise)} processed`}
        />
        <StatTile
          label="Successful"
          value={formatCount(stats.successful)}
          sub={formatPercent(stats.successful / (stats.totalTransactions || 1)) + " of total"}
        />
        <StatTile label="Failed" value={formatCount(stats.failed)} sub={formatPercent(stats.failed / (stats.totalTransactions || 1)) + " of total"} />
        <StatTile
          label="Pending at cutoff"
          value={formatCount(stats.pending)}
          sub="Uncertain final status"
          tone={stats.pending ? "warning" : undefined}
        />
        <StatTile
          label="Reconciliation rate"
          value={formatPercent(stats.reconciliationRate)}
          sub={`${formatCount(stats.matched)} fully matched`}
          tone={stats.reconciliationRate >= 0.98 ? "good" : undefined}
        />
        <StatTile label="Exceptions" value={formatCount(stats.exceptions)} sub={`${formatCount(data.openCount)} still open`} />
        <StatTile
          label="Transaction value affected"
          value={formatINRCompact(stats.affectedValuePaise)}
          sub={`${formatINRCompact(data.openAffected)} unresolved`}
        />
        <StatTile
          label="Needs manual investigation"
          value={formatCount(stats.manualReview)}
          sub="No automatic playbook"
          tone={stats.manualReview ? "critical" : undefined}
        />
      </dl>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="Exception categories" description="Click a category to open those exceptions." className="lg:col-span-2" id="categories">
          {categories.length ? (
            <BarList
              ariaLabel="Exceptions by category"
              formatValue={formatCount}
              items={categories
                .sort((a, b) => b.v!.count - a.v!.count)
                .map(({ c, v }) => ({
                  key: c,
                  label: CATEGORY_LABELS[c],
                  value: v!.count,
                  detail: formatINRCompact(v!.affectedPaise),
                  href: runLink(`&category=${c}`),
                }))}
            />
          ) : (
            <p className="text-sm text-ink-2">No exceptions in this run: every transaction matched across all participants.</p>
          )}
        </Card>
        <Card title="Where payments break" description="First participant in the payment path that disagrees." id="failure-points">
          {data.failurePoints.length ? (
            <BarList
              ariaLabel="Exceptions by failure point"
              formatValue={formatCount}
              items={data.failurePoints.map((f) => ({
                key: f.point,
                label: SOURCE_SHORT_LABELS[f.point],
                value: f.count,
                href: runLink(`&failurePoint=${f.point}`),
              }))}
            />
          ) : (
            <p className="text-sm text-ink-2">Nothing to locate.</p>
          )}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="Open work across all runs" id="portfolio">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-ink-3">Open exceptions</dt>
              <dd className="text-xl font-semibold">
                <Link href="/exceptions?status=OPEN,IN_REVIEW,PENDING_APPROVAL" className="hover:underline">
                  {formatCount(work.openCount)}
                </Link>
              </dd>
            </div>
            <div>
              <dt className="text-ink-3">Past TAT</dt>
              <dd className={`text-xl font-semibold ${work.breachedCount ? "text-critical" : ""}`}>
                <Link href="/exceptions?breached=yes" className="hover:underline">
                  {formatCount(work.breachedCount)}
                </Link>
              </dd>
            </div>
            <div>
              <dt className="text-ink-3">Compensation accrued</dt>
              <dd className="text-xl font-semibold">{formatINR(work.compensationPaise)}</dd>
            </div>
            <div>
              <dt className="text-ink-3">Assigned to you</dt>
              <dd className="text-xl font-semibold">
                <Link href="/exceptions?assignee=me&status=OPEN,IN_REVIEW,PENDING_APPROVAL" className="hover:underline">
                  {formatCount(work.assignedToMe)}
                </Link>
              </dd>
            </div>
            <div className="col-span-2">
              <dt className="text-ink-3">Awaiting supervisor approval</dt>
              <dd className="text-xl font-semibold">
                <Link href="/exceptions?status=PENDING_APPROVAL" className="hover:underline">
                  {formatCount(work.pendingApproval)}
                </Link>
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-ink-3">
            Compensation follows RBI&apos;s TAT circular (₹100/day for UPI and cards) and repo + 2% penal interest for NEFT/RTGS.
          </p>
        </Card>
        <Card title="Reconciliation rate, recent runs" className="lg:col-span-2" id="trend">
          <TrendChart
            points={trend.map((t) => ({
              id: t.id,
              label: shortBusinessDate(t.businessDate),
              rate: t.rate,
              total: t.total,
              exceptions: t.exceptions,
            }))}
          />
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card
          title="Manual investigation queue"
          description="Open exceptions with no automatic playbook, highest risk first."
          className="lg:col-span-2"
          id="queue"
          actions={
            <Link href={runLink("&manual=yes&status=OPEN,IN_REVIEW,PENDING_APPROVAL")} className="text-sm text-accent hover:underline">
              View all
            </Link>
          }
        >
          {data.queue.length ? (
            <div className="-mx-4 -mb-4 overflow-x-auto" tabIndex={0} role="region" aria-label="Scrollable table">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Reference</th>
                    <th scope="col">Category</th>
                    <th scope="col">Severity</th>
                    <th scope="col" className="num">
                      Affected
                    </th>
                    <th scope="col">TAT</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.queue.map((e) => {
                    const due = relativeDue(e.tatDueAt);
                    return (
                      <tr key={e.id}>
                        <td>
                          <Link href={`/exceptions/${e.id}`} className="mono text-accent hover:underline">
                            {e.txnRef}
                          </Link>
                          <div className="mt-0.5">
                            <MethodTag method={e.method} />
                          </div>
                        </td>
                        <td>{CATEGORY_LABELS[e.category]}</td>
                        <td>
                          <SeverityBadge severity={e.severity} />
                        </td>
                        <td className="num">{formatINR(e.affectedPaise)}</td>
                        <td className={due.overdue ? "font-medium text-critical" : "text-ink-2"}>{due.text}</td>
                        <td>
                          <StatusBadge status={e.status} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-ink-2">Nothing needs manual investigation in this run.</p>
          )}
        </Card>
        <Card title="By payment method" id="methods">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Method</th>
                <th scope="col" className="num">
                  Txns
                </th>
                <th scope="col" className="num">
                  Matched
                </th>
              </tr>
            </thead>
            <tbody>
              {PAYMENT_METHODS.filter((m) => stats.byMethod[m]).map((m) => {
                const v = stats.byMethod[m]!;
                return (
                  <tr key={m}>
                    <td>
                      <Link href={runLink(`&method=${m}`)} className="hover:underline">
                        <MethodTag method={m} />
                      </Link>
                    </td>
                    <td className="num">{formatCount(v.total)}</td>
                    <td className="num">{formatPercent(v.matched / (v.total || 1))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-ink-3">
            Refunds: {formatCount(stats.refunds)} ({formatCount(stats.refundsMatched)} matched)
          </p>
        </Card>
      </div>
    </>
  );
}
