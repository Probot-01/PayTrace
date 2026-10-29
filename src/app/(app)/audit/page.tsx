import type { Metadata } from "next";
import { z } from "zod";
import { AccessDenied, EmptyState, PageHeader, Pagination, buttonStyles } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { requirePage } from "@/server/auth/current";
import { listAudit } from "@/server/services/dashboard";
import { nonEmptyParams } from "@/lib/query";

export const metadata: Metadata = { title: "Audit log" };

const schema = z.object({
  action: z
    .string()
    .trim()
    .max(60)
    .regex(/^[a-z_.]*$/)
    .optional(),
  entityType: z.enum(["user", "exception", "source_file", "recon_run", "simulation", "settings", "session"]).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const { allowed } = await requirePage("audit:view");
  if (!allowed) return <AccessDenied what="the audit log" />;
  const raw = await searchParams;
  const parsed = schema.safeParse(nonEmptyParams(raw));
  const f = parsed.success ? parsed.data : { page: 1 };
  const { rows, total } = await listAudit({ ...f, pageSize: 50 });
  const qs = (page: number) => {
    const p = new URLSearchParams(Object.entries(raw).filter(([, v]) => v));
    p.set("page", String(page));
    return `?${p}`;
  };
  return (
    <>
      <PageHeader
        title="Audit log"
        description="Append-only record of sign-ins, data changes and exception decisions. Entries cannot be edited or deleted, including by administrators."
      />
      <form method="get" className="mb-3 flex flex-wrap items-end gap-2">
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-ink-3">Action starts with</span>
          <input
            name="action"
            defaultValue={raw.action ?? ""}
            placeholder="e.g. auth. or exception.resolve"
            className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-ink-3">Entity</span>
          <select name="entityType" defaultValue={raw.entityType ?? ""} className="rounded-md border border-line-strong bg-surface px-2 py-2 text-sm">
            <option value="">Any</option>
            {["user", "exception", "source_file", "recon_run", "simulation", "settings", "session"].map((t) => (
              <option key={t} value={t}>
                {t.replace("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <button className={buttonStyles.secondary}>Filter</button>
      </form>
      {rows.length === 0 ? (
        <EmptyState title="No audit events match" />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface" tabIndex={0} role="region" aria-label="Scrollable table">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Who</th>
                <th scope="col">Action</th>
                <th scope="col">Entity</th>
                <th scope="col">Details</th>
                <th scope="col">IP</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td className="whitespace-nowrap">{formatDateTime(a.createdAt)}</td>
                  <td>{a.actorName ?? a.actorEmail ?? "System"}</td>
                  <td className="mono">{a.action}</td>
                  <td className="text-xs">
                    {a.entityType}
                    {a.entityId ? <div className="mono text-ink-3">{a.entityId.slice(0, 13)}</div> : null}
                  </td>
                  <td className="max-w-md">
                    <code className="block truncate text-xs text-ink-2" title={JSON.stringify(a.metadata)}>
                      {Object.keys(a.metadata).length ? JSON.stringify(a.metadata) : "—"}
                    </code>
                  </td>
                  <td className="text-xs text-ink-3">{a.ip ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={f.page} pageSize={50} total={total} hrefFor={qs} />
    </>
  );
}
