"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiError } from "@/components/client/api";
import { Field, FormError, Input, Select } from "@/components/client/form";
import { buttonStyles } from "@/components/ui";
import { SIMULATION_PRESETS, type SimulationConfig } from "@/domain/simulator/simulate";
import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS } from "@/domain/types";

type Rates = SimulationConfig["faultRates"];

const RATE_FIELDS: { key: keyof Rates; label: string; help: string }[] = [
  { key: "businessDecline", label: "Business declines", help: "Insufficient funds, limits, wrong PIN: clean failures" },
  { key: "technicalDecline", label: "Technical declines", help: "Issuer unavailable before debit" },
  { key: "timeoutAfterDebit", label: "Timeouts after debit", help: "Customer debited, switch times out" },
  { key: "autoReversalShare", label: "…of which auto-reversed", help: "Share of those timeouts reversed before cutoff" },
  { key: "creditFailure", label: "Beneficiary credit failures", help: "Debited, then credit rejected" },
  { key: "deemedPending", label: "Deemed / pending", help: "No final status at cutoff" },
  { key: "delayedCredit", label: "Delayed credits", help: "Credit lands beyond the expected lag" },
  { key: "duplicateDebit", label: "Duplicate debits", help: "Same reference debited twice" },
  { key: "duplicateRequest", label: "Duplicate requests", help: "App retry creates a second payment" },
  { key: "merchantNotUpdated", label: "Merchant not updated", help: "Callback / webhook lost" },
  { key: "merchantPaidOnFailure", label: "Merchant marked paid on failure", help: "Optimistic order status" },
  { key: "missingRecord", label: "Missing records", help: "Absent from switch or acquirer file" },
  { key: "amountMismatch", label: "Amount mismatches", help: "Acquirer records a different amount" },
  { key: "settlementMiss", label: "Settlement misses", help: "Left out of the settlement report" },
  { key: "refund", label: "Refund rate", help: "Share of clean payments later refunded" },
  { key: "refundFailure", label: "…of which broken", help: "Refunds not credited or not booked" },
];

const pct = (v: number) => Math.round(v * 10_000) / 100;

export function SimulationForm({ defaultDate }: { defaultDate: string }) {
  const router = useRouter();
  const [presetKey, setPresetKey] = useState("normal");
  const preset = SIMULATION_PRESETS[presetKey].config;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<string[]>([]);
  const [seed] = useState(() => Math.floor(Math.random() * 2_000_000_000) + 1);

  return (
    <form
      key={presetKey}
      className="space-y-5"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const num = (k: string) => Number(f.get(k));
        const config = {
          businessDate: String(f.get("businessDate")),
          transactionCount: num("transactionCount"),
          seed: num("seed"),
          methodMix: Object.fromEntries(PAYMENT_METHODS.map((m) => [m, num(`mix_${m}`)])),
          faultRates: Object.fromEntries(RATE_FIELDS.map((r) => [r.key, num(`rate_${r.key}`) / 100])),
        };
        setBusy(true);
        setError(null);
        setFieldErrors([]);
        try {
          const { id } = await api<{ id: string }>("/api/v1/simulations", { json: { name: f.get("name"), config } });
          router.push(`/simulator/${id}`);
        } catch (err) {
          if (err instanceof ApiError) {
            setError(err.message);
            const d = err.details as { fieldErrors?: Record<string, string[]>; formErrors?: string[] } | null;
            setFieldErrors([...(d?.formErrors ?? []), ...Object.entries(d?.fieldErrors ?? {}).flatMap(([k, v]) => v.map((m) => `${k}: ${m}`))]);
          } else setError("Could not start the simulation.");
          setBusy(false);
        }
      }}
    >
      <FormError message={error} />
      {fieldErrors.length ? (
        <ul className="list-disc pl-5 text-sm text-critical">
          {fieldErrors.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Scenario">
          {(p) => (
            <Select {...p} value={presetKey} onChange={(e) => setPresetKey(e.target.value)}>
              {Object.entries(SIMULATION_PRESETS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Name">{(p) => <Input {...p} name="name" required minLength={3} maxLength={80} defaultValue={`${SIMULATION_PRESETS[presetKey].label} ${defaultDate}`} />}</Field>
        <Field label="Business date">{(p) => <Input {...p} type="date" name="businessDate" required defaultValue={defaultDate} />}</Field>
        <Field label="Payment intents" hint="10 to 100,000. Duplicate requests and refunds add rows.">
          {(p) => <Input {...p} type="number" name="transactionCount" min={10} max={100000} step={1} required defaultValue={preset.transactionCount} />}
        </Field>
        <Field label="Random seed" hint="The same seed and settings reproduce the same day exactly.">
          {(p) => <Input {...p} type="number" name="seed" min={1} max={2147483647} required defaultValue={seed} />}
        </Field>
      </div>
      <p className="text-sm text-ink-2">{SIMULATION_PRESETS[presetKey].description}</p>

      <fieldset className="rounded-lg border border-line p-4">
        <legend className="px-1 text-sm font-semibold">Payment method mix (relative weights)</legend>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {PAYMENT_METHODS.map((m) => (
            <Field key={m} label={PAYMENT_METHOD_LABELS[m]}>
              {(p) => <Input {...p} type="number" name={`mix_${m}`} min={0} max={100} step="0.1" required defaultValue={preset.methodMix[m]} />}
            </Field>
          ))}
        </div>
      </fieldset>

      <details className="rounded-lg border border-line p-4">
        <summary className="cursor-pointer text-sm font-semibold">Failure injection rates (%)</summary>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {RATE_FIELDS.map((r) => (
            <Field key={r.key} label={r.label} hint={r.help}>
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  name={`rate_${r.key}`}
                  min={0}
                  max={r.key === "autoReversalShare" || r.key === "refundFailure" ? 100 : 50}
                  step="0.01"
                  required
                  defaultValue={pct(preset.faultRates[r.key])}
                />
              )}
            </Field>
          ))}
        </div>
      </details>

      <button type="submit" className={buttonStyles.primary} disabled={busy}>
        {busy ? "Starting…" : "Generate business day"}
      </button>
    </form>
  );
}
