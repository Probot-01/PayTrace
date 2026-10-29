import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ConfirmAction } from "@/components/client/confirm-action";
import { JobPoller } from "@/components/client/job-poller";
import { PostButton } from "@/components/client/post-button";
import { AccessDenied, Alert, BarList, ButtonLink, Card, JobStatusBadge, PageHeader, StatTile } from "@/components/ui";
import { FAULT_LABELS } from "@/domain/simulator/simulate";
import { CATEGORY_LABELS, EXCEPTION_CATEGORIES, SOURCE_SHORT_LABELS } from "@/domain/types";
import { isAppError } from "@/lib/errors";
import { formatBusinessDate, formatDateTime } from "@/lib/format";
import { formatCount, formatINRCompact, formatPercent } from "@/lib/money";
import { requirePage } from "@/server/auth/current";
import { can } from "@/server/auth/permissions";
import { getRun } from "@/server/services/runs";
import { detectionAccuracy } from "@/server/services/simulations";

export const metadata: Metadata = { title: "Reconciliation run" };

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { user, allowed } = await requirePage("runs:view");
  if (!allowed) return <AccessDenied />;
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  let run;
  try {
    run = await getRun(id);
  } catch (err) {
    if (isAppError(err) && err.status === 404) notFound();
    throw err;
  }
  const simIds = [...new Set(run.files.map((f) => f.simulationId).filter(Boolean))] as string[];
  const accuracy = run.status === "COMPLETED" && simIds.length === 1 && run.files.every((f) => f.simulationId === simIds[0]) ? await detectionAccuracy(simIds[0], id) : null;
  const stats = run.stats;
  const duration = run.startedAt && run.finishedAt ? ((run.finishedAt.getTime() - run.startedAt.getTime()) / 1000).toFixed(1) : null;

  return (
    <>
      <PageHeader
        breadcrumb={[{ href: "/runs", label: "Reconciliation runs" }]}
        title={`Run for ${formatBusinessDate(run.businessDate)}`}
        description={
          <>
            Started {formatDateTime(run.createdAt)} by {run.createdByName ?? "—"}
            {duration ? ` · processed in ${duration}s` : ""}
          </>
        }
        actions={
          <div className="flex flex-wrap items-start gap-2">
            <JobStatusBadge status={run.status} />
            {run.status === "COMPLETED" ? (
              <>
                <ButtonLink href={`/exceptions?runId=${id}`} variant="primary">
                  Exceptions
                </ButtonLink>
                <ButtonLink href={`/?run=${id}`}>Dashboard</ButtonLink>
                <ButtonLink href={`/transactions?runId=${id}`}>Transactions</ButtonLink>
              </>
            ) : null}
            {can(user.role, "runs:create") && (run.status === "COMPLETED" || run.status === "FAILED") ? (
              <PostButton url="/api/v1/runs" body={{ businessDate: run.businessDate, fileIds: run.files.map((f) => f.id) }} label="Re-run" navigateTo={(r) => `/runs/${r.id}`} />
            ) : null}
            {can(user.role, "runs:delete") && (run.status === "COMPLETED" || run.status === "FAILED") ? (
              <ConfirmAction
                label="Delete"
                title="Delete this run?"
                body={`This permanently removes the run's ${formatCount(run.exceptionCount)} exceptions and their work history. Participant files are kept. The deletion is recorded in the audit log.`}
                confirmLabel="Delete run"
                url={`/api/v1/runs/${id}`}
                redirectTo="/runs"
              />
            ) : null}
          </div>
        }
      />

      {run.status === "QUEUED" || run.status === "RUNNING" ? (
        <Card>
          <JobPoller url={`/api/v1/runs/${id}`} label={run.status === "QUEUED" ? "Waiting for a worker to pick up the run…" : "Comparing participant records…"} />
        </Card>
      ) : null}
      {run.status === "FAILED" ? (
        <Alert tone="critical" title="The run failed">
          {run.error ?? "Unknown error."} Try re-running; if it fails again, check the worker logs.
        </Alert>
      ) : null}

      {stats ? (
        <>
          <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatTile label="Transactions" value={formatCount(stats.totalTransactions)} sub={`${formatCount(stats.recordsProcessed)} records`} />
            <StatTile label="Reconciliation rate" value={formatPercent(stats.reconciliationRate)} sub={`${formatCount(stats.matched)} matched`} />
            <StatTile label="Exceptions" value={formatCount(stats.exceptions)} sub={`${formatCount(stats.manualReview)} need manual work`} />
            <StatTile label="Value affected" value={formatINRCompact(stats.affectedValuePaise)} />
          </dl>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Card title="Exceptions by category" id="cats">
              {stats.exceptions ? (
                <BarList
                  ariaLabel="Exceptions by category"
                  formatValue={formatCount}
                  items={EXCEPTION_CATEGORIES.filter((c) => stats.byCategory[c]?.count).map((c) => ({
                    key: c,
                    label: CATEGORY_LABELS[c],
                    value: stats.byCategory[c]!.count,
                    detail: formatINRCompact(stats.byCategory[c]!.affectedPaise),
                    href: `/exceptions?runId=${id}&category=${c}`,
                  }))}
                />
              ) : (
                <p className="text-sm text-ink-2">Every transaction matched.</p>
              )}
            </Card>
            <Card title="Files compared" id="files">
              <ul className="space-y-2 text-sm">
                {run.files.map((f) => (
                  <li key={f.id} className="flex flex-wrap justify-between gap-2">
                    <span>
                      <span className="text-ink-3">{SOURCE_SHORT_LABELS[f.source]}:</span>{" "}
                      <Link href={`/files/${f.id}`} className="text-accent hover:underline">
                        {f.filename}
                      </Link>
                    </span>
                    <span className="tabular text-ink-3">{formatCount(f.rowCount)} rows</span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </>
      ) : null}

      {accuracy ? (
        <Card
          className="mt-4"
          id="accuracy"
          title="Detection accuracy against simulated ground truth"
          description="The simulator knows which fault it injected into each transaction, so the engine can be scored."
        >
          <dl className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatTile label="Faults that should be flagged" value={formatCount(accuracy.expectedFaults)} />
            <StatTile label="Detected with correct category" value={formatCount(accuracy.detected)} sub={`Recall ${formatPercent(accuracy.recall)}`} tone={accuracy.recall === 1 ? "good" : undefined} />
            <StatTile label="Exceptions raised" value={formatCount(accuracy.exceptionsRaised)} />
            <StatTile label="Precision" value={formatPercent(accuracy.precision)} sub="Raised exceptions that match an injected fault" />
          </dl>
          <div className="-mx-4 -mb-4 overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Injected fault</th>
                  <th scope="col">Expected category</th>
                  <th scope="col" className="num">Injected</th>
                  <th scope="col" className="num">Detected</th>
                </tr>
              </thead>
              <tbody>
                {accuracy.byFault.map((f) => (
                  <tr key={f.fault}>
                    <td>{FAULT_LABELS[f.fault]}</td>
                    <td className="text-ink-2">{f.expected ? CATEGORY_LABELS[f.expected] : "None (should match)"}</td>
                    <td className="num">{formatCount(f.injected)}</td>
                    <td className="num">{f.expected ? formatCount(f.detected) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </>
  );
}
