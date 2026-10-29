import type { Metadata } from "next";
import Link from "next/link";
import {
  AccessDenied,
  Card,
  EmptyState,
  MethodTag,
  PageHeader,
  Pagination,
  SeverityBadge,
  SourceName,
  StatusBadge,
  buttonStyles,
} from "@/components/ui";
import { AutoSubmitSelect } from "@/components/client/auto-submit-select";
import {
  CATEGORY_LABELS,
  EXCEPTION_CATEGORIES,
  EXCEPTION_STATUS_LABELS,
  EXCEPTION_STATUSES,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  SEVERITIES,
  SOURCE_SHORT_LABELS,
  SOURCE_SYSTEMS,
} from "@/domain/types";
import { formatBusinessDate, formatDateTime, relativeDue } from "@/lib/format";
import { formatCount, formatINR } from "@/lib/money";
import { requirePage } from "@/server/auth/current";
import { can } from "@/server/auth/permissions";
import { completedRunOptions } from "@/server/services/dashboard";
import { exceptionFilterSchema, listExceptions } from "@/server/services/exceptions";
import { nonEmptyParams } from "@/lib/query";

export const metadata: Metadata = { title: "Exceptions" };

type Search = Record<string, string | undefined>;

const selectCls = "w-full rounded-md border border-line-strong bg-surface px-2 py-2 text-sm";

export default async function ExceptionsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { user, allowed } = await requirePage("exceptions:view");
  if (!allowed) return <AccessDenied />;
  const raw = await searchParams;
  const parsed = exceptionFilterSchema.safeParse(nonEmptyParams(raw));
  const filter = parsed.success ? parsed.data : exceptionFilterSchema.parse({});
  const [{ rows, total, affectedPaise }, runs] = await Promise.all([listExceptions(filter, user.id), completedRunOptions()]);

  const query = (overrides: Search) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...raw, ...overrides })) if (v) p.set(k, v);
    return `?${p.toString()}`;
  };
  const exportQuery = query({ page: undefined, pageSize: undefined });
  const anyFilter = ["runId", "status", "category", "method", "severity", "failurePoint", "manual", "breached", "assignee", "q"].some((k) => raw[k]);

  return (
    <>
      <PageHeader
        title="Exceptions"
        description="Every discrepancy the reconciliation engine found, with the suspected cause, the participant where it broke, and the RBI or internal deadline to resolve it."
        actions={
          can(user.role, "exceptions:export") ? (
            <a className={buttonStyles.secondary} href={`/api/v1/exceptions/export${exportQuery}`} download>
              Export CSV
            </a>
          ) : null
        }
      />
      {!parsed.success ? (
        <p role="status" className="mb-3 text-sm text-warning">
          Some filters in the link were not valid and were ignored.
        </p>
      ) : null}

      <Card className="mb-4">
        <form method="get" className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6" aria-label="Filter exceptions">
          <label className="col-span-2 text-sm">
            <span className="mb-1 block text-xs font-medium text-ink-3">Reference starts with</span>
            <input name="q" defaultValue={filter.q ?? ""} className={selectCls} placeholder="RRN / UTR" maxLength={40} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs font-medium text-ink-3">Status</span>
            <select name="status" defaultValue={raw.status ?? ""} className={selectCls}>
              <option value="">Any status</option>
              <option value="OPEN,IN_REVIEW,PENDING_APPROVAL">Not closed</option>
              {EXCEPTION_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {EXCEPTION_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs font-medium text-ink-3">Category</span>
            <select name="category" defaultValue={raw.category ?? ""} className={selectCls}>
              <option value="">All categories</option>
              {EXCEPTION_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs font-medium text-ink-3">Severity</span>
            <select name="severity" defaultValue={raw.severity ?? ""} className={selectCls}>
              <option value="">Any severity</option>
              {[...SEVERITIES].reverse().map((s) => (
                <option key={s} value={s}>
                  {s.charAt(0) + s.slice(1).toLowerCase()}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs font-medium text-ink-3">Method</span>
            <select name="method" defaultValue={raw.method ?? ""} className={selectCls}>
              <option value="">All methods</option>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {PAYMENT_METHOD_LABELS[m]}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs font-medium text-ink-3">Failure point</span>
            <select name="failurePoint" defaultValue={raw.failurePoint ?? ""} className={selectCls}>
              <option value="">Anywhere</option>
              {SOURCE_SYSTEMS.map((s) => (
                <option key={s} value={s}>
                  {SOURCE_SHORT_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs font-medium text-ink-3">Assignee</span>
            <select name="assignee" defaultValue={raw.assignee ?? ""} className={selectCls}>
              <option value="">Anyone</option>
              <option value="me">Assigned to me</option>
              <option value="unassigned">Unassigned</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs font-medium text-ink-3">Handling</span>
            <select name="manual" defaultValue={raw.manual ?? ""} className={selectCls}>
              <option value="">Any</option>
              <option value="yes">Needs manual investigation</option>
              <option value="no">Has automatic playbook</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs font-medium text-ink-3">Deadline</span>
            <select name="breached" defaultValue={raw.breached ?? ""} className={selectCls}>
              <option value="">Any</option>
              <option value="yes">Past TAT, still open</option>
            </select>
          </label>
          <label className="col-span-2 text-sm">
            <span className="mb-1 block text-xs font-medium text-ink-3">Run</span>
            <select name="runId" defaultValue={raw.runId ?? ""} className={selectCls}>
              <option value="">All runs</option>
              {runs.map((r) => (
                <option key={r.id} value={r.id}>
                  {formatBusinessDate(r.businessDate)} · {formatDateTime(r.createdAt)}
                </option>
              ))}
            </select>
          </label>
          <input type="hidden" name="sort" value={filter.sort} />
          <div className="col-span-2 flex items-end gap-2 md:col-span-4 xl:col-span-2">
            <button type="submit" className={buttonStyles.primary}>
              Apply filters
            </button>
            {anyFilter ? (
              <Link href="/exceptions" className={buttonStyles.ghost}>
                Clear
              </Link>
            ) : null}
          </div>
        </form>
      </Card>

      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
        <p className="text-ink-2" role="status">
          <strong className="text-ink">{formatCount(total)}</strong> exception{total === 1 ? "" : "s"} · {formatINR(affectedPaise)} affected
        </p>
        <form method="get" className="flex items-center gap-2">
          {Object.entries(raw)
            .filter(([k, v]) => v && k !== "sort" && k !== "page")
            .map(([k, v]) => (
              <input key={k} type="hidden" name={k} value={v} />
            ))}
          <label htmlFor="sort" className="text-ink-3">
            Sort by
          </label>
          <AutoSubmitSelect
            id="sort"
            name="sort"
            defaultValue={filter.sort}
            className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm"
          >
            <option value="severity">Risk (severity, then amount)</option>
            <option value="due">TAT deadline</option>
            <option value="amount">Amount affected</option>
            <option value="newest">Newest transaction</option>
            <option value="oldest">Oldest transaction</option>
          </AutoSubmitSelect>
          <noscript>
            <button className={buttonStyles.secondary}>Sort</button>
          </noscript>
        </form>
      </div>

      {rows.length === 0 ? (
        <EmptyState title={anyFilter ? "No exceptions match these filters" : "No exceptions yet"}>
          {anyFilter ? "Try widening the filters or clearing them." : "Exceptions appear here after a reconciliation run finds discrepancies."}
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface" tabIndex={0} role="region" aria-label="Scrollable table">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Reference</th>
                <th scope="col">Category</th>
                <th scope="col">Severity</th>
                <th scope="col" className="num">
                  Affected
                </th>
                <th scope="col">Broke at</th>
                <th scope="col">Deadline</th>
                <th scope="col">Status</th>
                <th scope="col">Assignee</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => {
                const due = relativeDue(e.tatDueAt);
                const closed = e.status === "RESOLVED" || e.status === "DISMISSED";
                return (
                  <tr key={e.id}>
                    <td>
                      <Link href={`/exceptions/${e.id}`} className="mono font-medium text-accent hover:underline">
                        {e.txnRef}
                      </Link>
                      <div className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-3">
                        <MethodTag method={e.method} />
                        {formatDateTime(e.txnAt)}
                      </div>
                    </td>
                    <td>
                      {CATEGORY_LABELS[e.category]}
                      {e.requiresManual ? <div className="text-xs text-ink-3">Manual investigation</div> : null}
                    </td>
                    <td>
                      <SeverityBadge severity={e.severity} />
                    </td>
                    <td className="num">{formatINR(e.affectedPaise)}</td>
                    <td>
                      <SourceName source={e.failurePoint} />
                    </td>
                    <td className={!closed && due.overdue ? "font-medium text-critical" : "text-ink-2"}>
                      {closed ? "—" : due.text}
                      <div className="text-xs text-ink-3">{e.tatBasis === "RBI" ? "RBI TAT" : "Internal SLA"}</div>
                    </td>
                    <td>
                      <StatusBadge status={e.status} />
                    </td>
                    <td className="text-ink-2">{e.assigneeName ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={filter.page} pageSize={filter.pageSize} total={total} hrefFor={(p) => query({ page: String(p) })} />
    </>
  );
}
