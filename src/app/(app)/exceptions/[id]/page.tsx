import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { AccessDenied, Card, MethodTag, PageHeader, SeverityBadge, StatusBadge, cx } from "@/components/ui";
import { FAULT_LABELS, type InjectedFault, type TimelineEvent } from "@/domain/simulator/simulate";
import { CATEGORY_LABELS, RESOLUTION_LABELS, SOURCE_LABELS, SOURCE_SHORT_LABELS, SOURCE_SYSTEMS, type SourceSystem } from "@/domain/types";
import type { Compensation } from "@/domain/recon/tat";
import type { EvidenceRecord } from "@/domain/recon/engine";
import { formatBusinessDate, formatDateTime, formatTime, relativeDue } from "@/lib/format";
import { formatINR } from "@/lib/money";
import { isAppError } from "@/lib/errors";
import { requirePage } from "@/server/auth/current";
import { can } from "@/server/auth/permissions";
import { getException } from "@/server/services/exceptions";
import { getSimTransaction } from "@/server/services/simulations";
import { listAssignableUsers } from "@/server/services/users";
import { ExceptionActions } from "./actions";

export const metadata: Metadata = { title: "Exception" };

const statusTone = (s: string | undefined) =>
  s === "SUCCESS"
    ? "border-good/50 bg-good-soft text-good"
    : s === "FAILED" || s === "REVERSED"
      ? "border-critical/40 bg-critical-soft text-critical"
      : s === "PENDING"
        ? "border-warning/50 bg-warning-soft text-warning"
        : "border-dashed border-line-strong text-ink-3";

export default async function ExceptionPage({ params }: { params: Promise<{ id: string }> }) {
  const { user, allowed } = await requirePage("exceptions:view");
  if (!allowed) return <AccessDenied />;
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  let e;
  try {
    e = await getException(id);
  } catch (err) {
    if (isAppError(err) && err.status === 404) notFound();
    throw err;
  }
  const [sim, assignable] = await Promise.all([
    getSimTransaction(e.txnRef),
    can(user.role, "exceptions:work") ? listAssignableUsers() : Promise.resolve([]),
  ]);
  const evidence = e.evidence as {
    records: EvidenceRecord[];
    missingSources?: SourceSystem[];
    relatedRefs?: string[];
    rule: string;
  };
  const bySource = new Map<SourceSystem, EvidenceRecord>();
  for (const r of evidence.records) if (r.recordType !== "REVERSAL" && r.txnRef === e.txnRef && !bySource.has(r.source)) bySource.set(r.source, r);
  const reversal = evidence.records.find((r) => r.recordType === "REVERSAL");
  const open = ["OPEN", "IN_REVIEW", "PENDING_APPROVAL"].includes(e.status);
  const due = relativeDue(e.tatDueAt);
  const compensation = e.compensation as Compensation;

  return (
    <>
      <PageHeader
        breadcrumb={[{ href: "/exceptions", label: "Exceptions" }]}
        title={CATEGORY_LABELS[e.category]}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="mono text-ink">{e.txnRef}</span>
            <MethodTag method={e.method} />
            <span>{formatDateTime(e.txnAt)}</span>
            <span>·</span>
            <Link href={`/runs/${e.runId}`} className="text-accent underline underline-offset-2 hover:decoration-2">
              Run for {formatBusinessDate(e.runDate)}
            </Link>
          </span>
        }
        actions={
          <div className="flex items-center gap-2">
            <SeverityBadge severity={e.severity} />
            <StatusBadge status={e.status} />
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Payment path" description="Each participant's view of this payment. The highlighted step is where it first broke." id="path">
            <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
              <li className="rounded-md border border-line bg-surface-2 p-2 text-xs">
                <p className="font-semibold text-ink">Customer</p>
                <p className="text-ink-3">Initiated</p>
              </li>
              {SOURCE_SYSTEMS.map((s) => {
                const r = bySource.get(s);
                const isPoint = e.failurePoint === s;
                const missing = !r;
                return (
                  <li
                    key={s}
                    className={cx(
                      "rounded-md border p-2 text-xs",
                      statusTone(r?.status),
                      isPoint && "ring-2 ring-critical ring-offset-1 ring-offset-surface",
                    )}
                  >
                    <p className="font-semibold">{SOURCE_SHORT_LABELS[s]}</p>
                    <p>{missing ? "No record" : `${r.status.charAt(0)}${r.status.slice(1).toLowerCase()}${r.count > 1 ? ` ×${r.count}` : ""}`}</p>
                    {r ? <p className="tabular">{formatINR(r.amountPaise)}</p> : null}
                    {r ? <p className="tabular">{formatTime(r.eventAt)}</p> : null}
                    {isPoint ? <p className="mt-1 font-semibold">Failure point</p> : null}
                  </li>
                );
              })}
            </ol>
            {reversal ? (
              <p className="mt-3 text-sm text-ink-2">
                Reversal recorded by the issuer at {formatDateTime(reversal.eventAt)} for {formatINR(reversal.amountPaise)}.
              </p>
            ) : null}
            {evidence.relatedRefs?.length ? (
              <p className="mt-3 text-sm text-ink-2">
                Related reference{evidence.relatedRefs.length > 1 ? "s" : ""}:{" "}
                {evidence.relatedRefs.map((r) => (
                  <Link key={r} href={`/transactions/${encodeURIComponent(r)}`} className="mono text-accent hover:underline">
                    {r}
                  </Link>
                ))}
              </p>
            ) : null}
          </Card>

          <Card title="Diagnosis" id="diagnosis">
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-xs font-medium text-ink-3">Suspected cause</dt>
                <dd className="mt-0.5 text-ink">{e.suspectedCause}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-ink-3">Recommended action</dt>
                <dd className="mt-0.5 text-ink">{e.recommendedAction}</dd>
              </div>
            </dl>
            <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-2 text-sm">
              <div>
                <dt className="text-xs font-medium text-ink-3">Handling</dt>
                <dd>{e.requiresManual ? "Manual investigation" : "Automatic playbook available"}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-ink-3">Rule</dt>
                <dd>{evidence.rule}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-ink-3">Failure point</dt>
                <dd>{e.failurePoint ? SOURCE_LABELS[e.failurePoint] : "Not attributable"}</dd>
              </div>
            </dl>
          </Card>

          <Card title="Participant records" description="Raw lines from the files in this run that carry this reference." id="records">
            {e.records.length ? (
              <div className="-mx-4 -mb-4 overflow-x-auto" tabIndex={0} role="region" aria-label="Scrollable table">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">Participant</th>
                      <th scope="col">Type</th>
                      <th scope="col">Status (raw)</th>
                      <th scope="col" className="num">
                        Amount
                      </th>
                      <th scope="col">Time</th>
                      <th scope="col">File · line</th>
                    </tr>
                  </thead>
                  <tbody>
                    {e.records.map((r) => (
                      <tr key={r.id}>
                        <td>{SOURCE_SHORT_LABELS[r.source]}</td>
                        <td>{r.recordType.toLowerCase()}</td>
                        <td>
                          {r.status.toLowerCase()} <span className="text-ink-3">({r.rawStatus})</span>
                        </td>
                        <td className="num">{formatINR(r.amountPaise)}</td>
                        <td className="whitespace-nowrap">{formatDateTime(r.eventAt)}</td>
                        <td className="text-ink-3">
                          <Link href={`/files/${r.fileId}`} className="hover:underline">
                            {r.filename}
                          </Link>{" "}
                          · {r.lineNo}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-ink-2">No participant records carry this reference (it was inferred from a related transaction).</p>
            )}
          </Card>

          {sim ? (
            <Card title="Simulation ground truth" description={`From simulation “${sim.simName}”. Shown only for simulated data.`} id="sim">
              <p className="text-sm">
                Injected fault: <strong>{FAULT_LABELS[sim.tx.injectedFault as InjectedFault] ?? sim.tx.injectedFault}</strong>
                {sim.tx.failureStage ? (
                  <>
                    {" "}
                    at stage <span className="mono">{sim.tx.failureStage}</span>
                  </>
                ) : null}
              </p>
              <ol className="mt-3 space-y-1 border-l border-line pl-4 text-sm">
                {(sim.tx.timeline as TimelineEvent[]).map((t, i) => (
                  <li key={i} className="relative">
                    <span
                      aria-hidden
                      className={cx(
                        "absolute -left-[21px] top-1.5 h-2 w-2 rounded-full",
                        t.status === "OK" ? "bg-good" : t.status === "PENDING" ? "bg-warning" : "bg-critical",
                      )}
                    />
                    <span className="mono text-xs text-ink-3">{formatTime(t.at)}</span>{" "}
                    <span className="font-medium">{t.stage.replaceAll("_", " ").toLowerCase()}</span> · {t.status.toLowerCase()}
                    {t.note ? <span className="text-ink-2"> · {t.note}</span> : null}
                  </li>
                ))}
              </ol>
            </Card>
          ) : null}
        </div>

        <div className="space-y-4">
          <Card title="Money and deadline" id="money">
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-ink-3">Transaction amount</dt>
                <dd className="tabular font-medium">{formatINR(e.amountPaise)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-ink-3">Amount affected</dt>
                <dd className="tabular font-medium">{formatINR(e.affectedPaise)}</dd>
              </div>
              <div>
                <dt className="text-ink-3">{e.tatBasis === "RBI" ? "RBI turn-around time" : "Internal SLA"}</dt>
                <dd className="mt-0.5">{e.tatDescription}</dd>
                <dd className={cx("mt-0.5 font-medium", open && due.overdue ? "text-critical" : "text-ink")}>
                  {formatDateTime(e.tatDueAt)}
                  {open ? ` (${due.text})` : ""}
                </dd>
              </div>
              {compensation.kind !== "NONE" ? (
                <div className="flex justify-between gap-2">
                  <dt className="text-ink-3">{open ? "Compensation accrued so far" : "Compensation owed at closure"}</dt>
                  <dd className={cx("tabular font-semibold", e.compensationPaise ? "text-critical" : "")}>{formatINR(e.compensationPaise)}</dd>
                </div>
              ) : null}
            </dl>
          </Card>

          <Card title="Work this exception" id="work">
            <dl className="mb-4 space-y-2 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-ink-3">Assignee</dt>
                <dd>{e.assigneeName ?? "Unassigned"}</dd>
              </div>
              {e.resolutionCode || e.resolutionNote ? (
                <div>
                  <dt className="text-ink-3">{e.status === "PENDING_APPROVAL" ? `Proposed by ${e.proposedByName ?? "—"}` : "Resolution"}</dt>
                  <dd className="mt-0.5">
                    {e.resolutionCode ? (
                      <strong>{RESOLUTION_LABELS[e.resolutionCode]}. </strong>
                    ) : e.status === "PENDING_APPROVAL" || e.status === "DISMISSED" ? (
                      <strong>Dismissal. </strong>
                    ) : null}
                    {e.resolutionNote}
                  </dd>
                </div>
              ) : null}
              {e.resolvedAt ? (
                <div className="flex justify-between gap-2">
                  <dt className="text-ink-3">Closed by</dt>
                  <dd>
                    {e.resolvedByName ?? "—"}, {formatDateTime(e.resolvedAt)}
                  </dd>
                </div>
              ) : null}
            </dl>
            <ExceptionActions
              exception={{
                id: e.id,
                status: e.status,
                version: e.version,
                assigneeId: e.assigneeId,
                proposedBy: e.proposedBy,
                affectedPaise: e.affectedPaise,
              }}
              approvalThresholdPaise={e.approvalThresholdPaise}
              user={{ id: user.id, role: user.role }}
              canWork={can(user.role, "exceptions:work")}
              canApprove={can(user.role, "exceptions:approve")}
              assignable={assignable}
            />
          </Card>

          <Card title="Activity" id="activity">
            {e.activity.length ? (
              <ol className="space-y-3 text-sm">
                {e.activity.map((a) => (
                  <li key={a.id}>
                    <p className="text-xs text-ink-3">
                      {a.actorName ?? "System"} · {formatDateTime(a.createdAt)}
                    </p>
                    <p className={a.kind === "COMMENT" ? "whitespace-pre-wrap text-ink" : "text-ink-2"}>{a.body}</p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-ink-3">No activity yet.</p>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
