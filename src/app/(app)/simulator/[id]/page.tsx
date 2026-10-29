import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ConfirmAction } from "@/components/client/confirm-action";
import { JobPoller } from "@/components/client/job-poller";
import { PostButton } from "@/components/client/post-button";
import { AccessDenied, Alert, BarList, Card, JobStatusBadge, PageHeader } from "@/components/ui";
import { FAULT_LABELS, simulationConfigSchema, type InjectedFault } from "@/domain/simulator/simulate";
import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS, SOURCE_SHORT_LABELS } from "@/domain/types";
import { isAppError } from "@/lib/errors";
import { formatBusinessDate, formatDateTime } from "@/lib/format";
import { formatCount, formatPercent } from "@/lib/money";
import { requirePage } from "@/server/auth/current";
import { can } from "@/server/auth/permissions";
import { getSimulation } from "@/server/services/simulations";

export const metadata: Metadata = { title: "Simulation" };

export default async function SimulationPage({ params }: { params: Promise<{ id: string }> }) {
  const { user, allowed } = await requirePage("simulations:view");
  if (!allowed) return <AccessDenied />;
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  let data;
  try {
    data = await getSimulation(id);
  } catch (err) {
    if (isAppError(err) && err.status === 404) notFound();
    throw err;
  }
  const { sim, files, runs } = data;
  const config = simulationConfigSchema.safeParse(sim.config);
  const faults = Object.entries(sim.faultCounts).sort((a, b) => b[1] - a[1]);
  const totalMix = config.success ? PAYMENT_METHODS.reduce((s, m) => s + config.data.methodMix[m], 0) : 1;

  return (
    <>
      <PageHeader
        breadcrumb={[{ href: "/simulator", label: "Simulator" }]}
        title={sim.name}
        description={`Simulated business date ${formatBusinessDate(sim.businessDate)} · created ${formatDateTime(sim.createdAt)}${config.success ? ` · seed ${config.data.seed}` : ""}`}
        actions={
          <div className="flex flex-wrap items-start gap-2">
            <JobStatusBadge status={sim.status} />
            {sim.status === "COMPLETED" && can(user.role, "runs:create") ? (
              <PostButton
                variant="primary"
                url="/api/v1/runs"
                body={{ businessDate: sim.businessDate, fileIds: files.map((f) => f.id) }}
                label={runs.length ? "Reconcile again" : "Reconcile this day"}
                navigateTo={(r) => `/runs/${r.id}`}
              />
            ) : null}
            {can(user.role, "simulations:delete") && sim.status !== "RUNNING" && sim.status !== "QUEUED" ? (
              <ConfirmAction
                label="Delete"
                title="Delete this simulation?"
                body="Its generated transactions and participant files are removed. Simulations whose files were reconciled cannot be deleted until those runs are deleted."
                confirmLabel="Delete simulation"
                url={`/api/v1/simulations/${id}`}
                redirectTo="/simulator"
              />
            ) : null}
          </div>
        }
      />
      {sim.status === "QUEUED" || sim.status === "RUNNING" ? (
        <Card>
          <JobPoller url={`/api/v1/simulations/${id}`} label="Generating transactions and participant files…" />
        </Card>
      ) : null}
      {sim.status === "FAILED" ? <Alert tone="critical" title="Simulation failed">{sim.error ?? "Unknown error."}</Alert> : null}

      {sim.status === "COMPLETED" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="What the switch did" description={`${formatCount(sim.transactionCount)} transactions (including duplicate requests and refunds).`} id="faults">
            <BarList
              ariaLabel="Injected outcomes"
              formatValue={formatCount}
              items={faults.map(([k, v]) => ({ key: k, label: FAULT_LABELS[k as InjectedFault] ?? k, value: v, detail: formatPercent(v / (sim.transactionCount || 1)) }))}
            />
          </Card>
          <div className="space-y-4">
            <Card title="Participant files produced" id="files">
              <ul className="space-y-2 text-sm">
                {files.map((f) => (
                  <li key={f.id} className="flex justify-between gap-2">
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
            {config.success ? (
              <Card title="Method mix" id="mix">
                <ul className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
                  {PAYMENT_METHODS.map((m) => (
                    <li key={m}>
                      <span className="text-ink-3">{PAYMENT_METHOD_LABELS[m]}:</span> {formatPercent(config.data.methodMix[m] / totalMix, 0)}
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}
            <Card title="Reconciliation runs on this data" id="runs">
              {runs.length ? (
                <ul className="space-y-2 text-sm">
                  {runs.map((r) => (
                    <li key={r.id} className="flex justify-between gap-2">
                      <Link href={`/runs/${r.id}`} className="text-accent hover:underline">
                        {formatDateTime(r.createdAt)}
                      </Link>
                      <span className="text-ink-3">{r.status === "COMPLETED" ? `${formatPercent(r.total ? r.matched / r.total : 0)} reconciled` : r.status.toLowerCase()}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-ink-2">Not reconciled yet. Use “Reconcile this day” to compare the five files and score the engine against the injected faults.</p>
              )}
            </Card>
          </div>
        </div>
      ) : null}
    </>
  );
}
