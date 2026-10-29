import type { Metadata } from "next";
import Link from "next/link";
import { AccessDenied, Card, EmptyState, JobStatusBadge, PageHeader } from "@/components/ui";
import { formatBusinessDate, formatDateTime, todayIst } from "@/lib/format";
import { formatCount } from "@/lib/money";
import { requirePage } from "@/server/auth/current";
import { can } from "@/server/auth/permissions";
import { listSimulations } from "@/server/services/simulations";
import { SimulationForm } from "./simulation-form";

export const metadata: Metadata = { title: "Simulator" };

export default async function SimulatorPage() {
  const { user, allowed } = await requirePage("simulations:view");
  if (!allowed) return <AccessDenied />;
  const sims = await listSimulations();
  const yesterday = new Date(Date.parse(`${todayIst()}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  return (
    <>
      <PageHeader
        title="Transaction simulator"
        description="Generates a realistic business day of UPI, card, NEFT and RTGS payments, routes each through a simulated switch (Customer → Switch → Issuer → Acquirer → Merchant → Settlement) with injected faults, and writes one record file per participant. Simulated data is labelled as such everywhere."
      />
      <div className="grid gap-4 xl:grid-cols-5">
        {can(user.role, "simulations:create") ? (
          <Card title="New simulation" className="xl:col-span-3" id="new">
            <SimulationForm defaultDate={yesterday} />
          </Card>
        ) : null}
        <Card title="Previous simulations" className={can(user.role, "simulations:create") ? "xl:col-span-2" : "xl:col-span-5"} id="list">
          {sims.length === 0 ? (
            <EmptyState title="No simulations yet">
              Generate a business day to see how the reconciliation engine handles each failure mode.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {sims.map((s) => (
                <li key={s.id} className="flex items-start justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <Link href={`/simulator/${s.id}`} className="block truncate font-medium text-accent hover:underline">
                      {s.name}
                    </Link>
                    <p className="text-xs text-ink-3">
                      {formatBusinessDate(s.businessDate)} · {s.status === "COMPLETED" ? `${formatCount(s.transactionCount)} transactions` : "—"} ·{" "}
                      {formatDateTime(s.createdAt)}
                    </p>
                  </div>
                  <JobStatusBadge status={s.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
