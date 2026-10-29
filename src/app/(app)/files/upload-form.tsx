"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { api, ApiError } from "@/components/client/api";
import { Field, FormError, Input, Select } from "@/components/client/form";
import { buttonStyles } from "@/components/ui";
import { SOURCE_LABELS, SOURCE_SYSTEMS } from "@/domain/types";
import { formatCount } from "@/lib/money";

interface RowError {
  line: number;
  column: string;
  message: string;
}

const MAX_MB = 25;

export function UploadForm({ defaultDate }: { defaultDate: string }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<{ rows: RowError[]; total: number } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [success, setSuccess] = useState<string | null>(null);

  return (
    <form
      ref={formRef}
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        const file = form.get("file");
        setError(null);
        setRowErrors(null);
        setFieldErrors({});
        setSuccess(null);
        if (!(file instanceof File) || file.size === 0) {
          setFieldErrors({ file: ["Choose a CSV file."] });
          return;
        }
        if (file.size > MAX_MB * 1024 * 1024) {
          setFieldErrors({ file: [`The file is larger than ${MAX_MB} MB.`] });
          return;
        }
        setBusy(true);
        try {
          const res = await api<{ id: string; rowCount: number }>("/api/v1/files", { form });
          setSuccess(`Imported ${formatCount(res.rowCount)} records.`);
          formRef.current?.reset();
          router.refresh();
        } catch (err) {
          if (err instanceof ApiError) {
            setError(err.message);
            setFieldErrors(err.fieldErrors());
            const d = err.details as { rowErrors?: RowError[]; totalErrors?: number } | null;
            if (d?.rowErrors) setRowErrors({ rows: d.rowErrors, total: d.totalErrors ?? d.rowErrors.length });
          } else setError("Upload failed. Try again.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <FormError message={error} />
      {success ? (
        <p role="status" className="rounded-md border border-good/40 bg-good-soft px-3 py-2 text-sm text-good">
          {success}
        </p>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Participant" error={fieldErrors.source?.[0]}>
          {(p) => (
            <Select {...p} name="source" required defaultValue="">
              <option value="" disabled>
                Choose…
              </option>
              {SOURCE_SYSTEMS.map((s) => (
                <option key={s} value={s}>
                  {SOURCE_LABELS[s]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Business date" error={fieldErrors.businessDate?.[0]}>
          {(p) => <Input {...p} type="date" name="businessDate" required defaultValue={defaultDate} />}
        </Field>
      </div>
      <Field
        label="CSV file"
        error={fieldErrors.file?.[0]}
        hint={`UTF-8 CSV in the PayTrace column layout, up to ${MAX_MB} MB / 250,000 rows. Card numbers are rejected.`}
      >
        {(p) => (
          <Input
            {...p}
            type="file"
            name="file"
            accept=".csv,text/csv"
            required
            className="file:mr-3 file:rounded file:border-0 file:bg-surface-2 file:px-2 file:py-1"
          />
        )}
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className={buttonStyles.primary} disabled={busy}>
          {busy ? "Validating and importing…" : "Upload"}
        </button>
        <a href="/api/v1/files/template" className="text-sm text-accent hover:underline" download>
          Download template
        </a>
      </div>
      {rowErrors ? (
        <div className="rounded-md border border-critical/40">
          <p className="border-b border-critical/30 bg-critical-soft px-3 py-2 text-sm font-medium text-critical">
            {formatCount(rowErrors.total)} problem(s) found{rowErrors.total > rowErrors.rows.length ? `; first ${rowErrors.rows.length} shown` : ""}.
            Fix them and upload again.
          </p>
          <div className="max-h-72 overflow-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Line</th>
                  <th scope="col">Column</th>
                  <th scope="col">Problem</th>
                </tr>
              </thead>
              <tbody>
                {rowErrors.rows.map((r, i) => (
                  <tr key={i}>
                    <td className="tabular">{r.line || "—"}</td>
                    <td className="mono">{r.column}</td>
                    <td>{r.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </form>
  );
}
