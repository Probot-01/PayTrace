"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiError } from "@/components/client/api";
import { Field, FormError, Input } from "@/components/client/form";
import { buttonStyles } from "@/components/ui";
import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS } from "@/domain/types";
import type { AppSettings } from "@/server/services/settings";

const rupees = (paise: number) => paise / 100;

export function SettingsForm({ initial }: { initial: AppSettings }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  return (
    <form
      className="space-y-6"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const n = (k: string) => Number(f.get(k));
        const body: AppSettings = {
          amountTolerancePaise: Math.round(n("amountTolerance") * 100),
          duplicateWindowMinutes: n("duplicateWindowMinutes"),
          creditSlaMinutes: Object.fromEntries(PAYMENT_METHODS.map((m) => [m, n(`sla_${m}`)])) as AppSettings["creditSlaMinutes"],
          highValuePaise: Math.round(n("highValue") * 100),
          approvalThresholdPaise: Math.round(n("approvalThreshold") * 100),
          repoRateBps: Math.round(n("repoRate") * 100),
        };
        setBusy(true);
        setError(null);
        setSaved(false);
        try {
          await api("/api/v1/settings", { method: "PUT", json: body });
          setSaved(true);
          router.refresh();
        } catch (err) {
          setError(err instanceof ApiError ? err.message : "Could not save settings.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <FormError message={error} />
      {saved ? (
        <p role="status" className="rounded-md border border-good/40 bg-good-soft px-3 py-2 text-sm text-good">
          Settings saved. They apply to the next run.
        </p>
      ) : null}
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold">Matching</legend>
        <Field label="Amount tolerance (₹)" hint="Differences at or below this are treated as equal.">
          {(p) => <Input {...p} type="number" name="amountTolerance" min={0} max={100} step="0.01" defaultValue={rupees(initial.amountTolerancePaise)} required />}
        </Field>
        <Field label="Duplicate request window (minutes)" hint="Same customer, merchant and amount debited twice within this window.">
          {(p) => <Input {...p} type="number" name="duplicateWindowMinutes" min={1} max={1440} defaultValue={initial.duplicateWindowMinutes} required />}
        </Field>
      </fieldset>
      <fieldset>
        <legend className="mb-2 text-sm font-semibold">Maximum expected credit lag (minutes)</legend>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {PAYMENT_METHODS.map((m) => (
            <Field key={m} label={PAYMENT_METHOD_LABELS[m]}>
              {(p) => <Input {...p} type="number" name={`sla_${m}`} min={1} max={1440} defaultValue={initial.creditSlaMinutes[m]} required />}
            </Field>
          ))}
        </div>
      </fieldset>
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold">Risk and control</legend>
        <Field label="Critical value threshold (₹)" hint="Exceptions affecting at least this much are critical and always need manual review.">
          {(p) => <Input {...p} type="number" name="highValue" min={1000} step="1" defaultValue={rupees(initial.highValuePaise)} required />}
        </Field>
        <Field label="Maker-checker threshold (₹)" hint="Analyst resolutions at or above this need a supervisor's approval. 0 = always.">
          {(p) => <Input {...p} type="number" name="approvalThreshold" min={0} step="1" defaultValue={rupees(initial.approvalThresholdPaise)} required />}
        </Field>
        <Field label="RBI policy repo rate (%)" hint="NEFT/RTGS penal interest is repo + 2%. Update after each MPC decision.">
          {(p) => <Input {...p} type="number" name="repoRate" min={0} max={20} step="0.01" defaultValue={initial.repoRateBps / 100} required />}
        </Field>
      </fieldset>
      <button type="submit" className={buttonStyles.primary} disabled={busy}>
        {busy ? "Saving…" : "Save settings"}
      </button>
    </form>
  );
}
