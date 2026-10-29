import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { appSettings } from "@/db/schema";
import { DEFAULT_RECON_CONFIG, type ReconConfig } from "@/domain/recon/engine";
import { audit, type AuditActor } from "../audit";

const minutes = z
  .number()
  .int()
  .min(1)
  .max(24 * 60);

export const settingsSchema = z.object({
  amountTolerancePaise: z.number().int().min(0).max(100_00),
  duplicateWindowMinutes: minutes,
  creditSlaMinutes: z.object({ UPI: minutes, DEBIT_CARD: minutes, CREDIT_CARD: minutes, NEFT: minutes, RTGS: minutes }),
  highValuePaise: z.number().int().min(1_000_00).max(100_00_00_000_00),
  /** Maker-checker: resolving an exception that affects at least this much needs a supervisor's approval. */
  approvalThresholdPaise: z.number().int().min(0).max(100_00_00_000_00),
  /** RBI policy repo rate in basis points; NEFT/RTGS penal interest is repo + 2%. */
  repoRateBps: z.number().int().min(0).max(2_000),
});

export type AppSettings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: AppSettings = {
  ...DEFAULT_RECON_CONFIG,
  approvalThresholdPaise: 50_000_00,
  repoRateBps: 550, // 5.50% (RBI MPC, 7 Oct 2026). Update when the policy rate changes.
};

const KEY = "recon";

export async function getSettings(): Promise<AppSettings> {
  const rows = await getDb().select().from(appSettings).where(eq(appSettings.key, KEY)).limit(1);
  if (!rows[0]) return DEFAULT_SETTINGS;
  const merged = { ...DEFAULT_SETTINGS, ...(rows[0].value as Partial<AppSettings>) };
  const parsed = settingsSchema.safeParse(merged);
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}

export function toReconConfig(s: AppSettings): ReconConfig {
  return {
    amountTolerancePaise: s.amountTolerancePaise,
    duplicateWindowMinutes: s.duplicateWindowMinutes,
    creditSlaMinutes: s.creditSlaMinutes,
    highValuePaise: s.highValuePaise,
  };
}

export async function updateSettings(actor: AuditActor, input: AppSettings): Promise<AppSettings> {
  const value = settingsSchema.parse(input);
  const before = await getSettings();
  await getDb().transaction(async (tx) => {
    await tx
      .insert(appSettings)
      .values({ key: KEY, value, updatedBy: actor.id, updatedAt: new Date() })
      .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedBy: actor.id, updatedAt: new Date() } });
    await audit(actor, "settings.update", "settings", KEY, { before, after: value }, tx);
  });
  return value;
}
