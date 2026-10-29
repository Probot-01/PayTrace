"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { api, ApiError } from "@/components/client/api";
import { FormError } from "@/components/client/form";
import { buttonStyles } from "@/components/ui";
import { SOURCE_LABELS, SOURCE_SYSTEMS, type SourceSystem } from "@/domain/types";
import { formatDateTime } from "@/lib/format";
import { formatCount } from "@/lib/money";

interface FileOption {
  id: string;
  source: SourceSystem;
  filename: string;
  rowCount: number;
  origin: "UPLOAD" | "SIMULATOR";
  createdAt: string;
}

export function NewRunForm({ businessDate, files }: { businessDate: string; files: FileOption[] }) {
  const router = useRouter();
  const initial = useMemo(() => {
    const seen = new Set<string>();
    const ids = new Set<string>();
    for (const f of files) {
      if (seen.has(f.source)) continue;
      seen.add(f.source);
      ids.add(f.id);
    }
    return ids;
  }, [files]);
  const [selected, setSelected] = useState<Set<string>>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sources = new Set(files.filter((f) => selected.has(f.id)).map((f) => f.source));

  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          const { id } = await api<{ id: string }>("/api/v1/runs", { json: { businessDate, fileIds: [...selected] } });
          router.push(`/runs/${id}`);
        } catch (err) {
          setError(err instanceof ApiError ? err.message : "Could not start the run.");
          setBusy(false);
        }
      }}
    >
      <FormError message={error} />
      {SOURCE_SYSTEMS.map((source) => {
        const options = files.filter((f) => f.source === source);
        return (
          <fieldset key={source} className="rounded-lg border border-line bg-surface p-4">
            <legend className="px-1 text-sm font-semibold">{SOURCE_LABELS[source]}</legend>
            {options.length === 0 ? (
              <p className="text-sm text-ink-3">No file for this date. Records expected here will be reported as missing.</p>
            ) : (
              <ul className="space-y-2">
                {options.map((f) => (
                  <li key={f.id}>
                    <label className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4"
                        checked={selected.has(f.id)}
                        onChange={(e) => {
                          const next = new Set(selected);
                          if (e.target.checked) next.add(f.id);
                          else next.delete(f.id);
                          setSelected(next);
                        }}
                      />
                      <span>
                        <span className="font-medium">{f.filename}</span>
                        <span className="block text-xs text-ink-3">
                          {formatCount(f.rowCount)} rows · {f.origin === "SIMULATOR" ? "simulated" : "uploaded"} {formatDateTime(f.createdAt)}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </fieldset>
        );
      })}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className={buttonStyles.primary} disabled={busy || sources.size < 2}>
          {busy ? "Starting…" : "Start reconciliation"}
        </button>
        <p className="text-sm text-ink-3" role="status">
          {sources.size < 2 ? "Select files from at least two participants." : `${selected.size} file(s) from ${sources.size} participants selected.`}
        </p>
      </div>
    </form>
  );
}
