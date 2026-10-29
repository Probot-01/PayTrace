import type { Metadata } from "next";
import { AccessDenied, ButtonLink, EmptyState, PageHeader } from "@/components/ui";
import { AutoSubmitSelect } from "@/components/client/auto-submit-select";
import { formatBusinessDate } from "@/lib/format";
import { requirePage } from "@/server/auth/current";
import { datesWithFiles, filesForDate } from "@/server/services/files";
import { NewRunForm } from "./new-run-form";

export const metadata: Metadata = { title: "New reconciliation run" };

export default async function NewRunPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const { allowed } = await requirePage("runs:create");
  if (!allowed) return <AccessDenied what="starting reconciliation runs" />;
  const dates = await datesWithFiles();
  const { date } = await searchParams;
  const selected = dates.find((d) => d.businessDate === date)?.businessDate ?? dates[0]?.businessDate;
  const files = selected ? await filesForDate(selected) : [];

  return (
    <>
      <PageHeader
        title="New reconciliation run"
        breadcrumb={[{ href: "/runs", label: "Reconciliation runs" }]}
        description="Choose a business date and the participant files to compare. The latest file from each participant is selected by default."
      />
      {dates.length === 0 ? (
        <EmptyState
          title="No participant files yet"
          action={
            <div className="flex gap-2">
              <ButtonLink href="/simulator" variant="primary">
                Simulate a day
              </ButtonLink>
              <ButtonLink href="/files">Upload files</ButtonLink>
            </div>
          }
        >
          Load files from at least two participants first.
        </EmptyState>
      ) : (
        <div className="max-w-3xl space-y-4">
          <form method="get" className="flex items-end gap-2">
            <label className="text-sm">
              <span className="mb-1 block text-xs font-medium text-ink-3">Business date</span>
              <AutoSubmitSelect name="date" defaultValue={selected} className="rounded-md border border-line-strong bg-surface px-2 py-2 text-sm">
                {dates.map((d) => (
                  <option key={d.businessDate} value={d.businessDate}>
                    {formatBusinessDate(d.businessDate)} · {d.files} file{d.files === 1 ? "" : "s"} from {d.sources} participant
                    {d.sources === 1 ? "" : "s"}
                  </option>
                ))}
              </AutoSubmitSelect>
            </label>
            <noscript>
              <button className="rounded-md border px-3 py-2 text-sm">Load</button>
            </noscript>
          </form>
          <NewRunForm key={selected} businessDate={selected!} files={files.map((f) => ({ ...f, createdAt: f.createdAt.toISOString() }))} />
        </div>
      )}
    </>
  );
}
