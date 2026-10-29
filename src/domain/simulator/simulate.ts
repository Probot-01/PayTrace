import { z } from "zod";
import type { ExceptionCategory, NormalizedRecord, PaymentMethod, RecordStatus, SourceSystem } from "../types";
import { PAYMENT_METHODS } from "../types";
import { Rng } from "./rng";

/**
 * Transaction simulator + simplified payment switch.
 *
 * A payment intent is routed Customer → Switch → Issuer (debit) → Switch → Acquirer (credit)
 * → Merchant (notification) → Settlement. Faults are injected at specific hops so that each
 * participant ends up with its own, possibly inconsistent, view of the payment. Those views are
 * then exported as one record file per participant, which is exactly what a reconciliation team
 * receives in real life.
 */

export const BANKS = [
  { code: "SBIN", name: "State Bank of India" },
  { code: "HDFC", name: "HDFC Bank" },
  { code: "ICIC", name: "ICICI Bank" },
  { code: "UTIB", name: "Axis Bank" },
  { code: "PUNB", name: "Punjab National Bank" },
  { code: "BARB", name: "Bank of Baroda" },
  { code: "KKBK", name: "Kotak Mahindra Bank" },
  { code: "CNRB", name: "Canara Bank" },
  { code: "UBIN", name: "Union Bank of India" },
  { code: "YESB", name: "Yes Bank" },
] as const;

export const INJECTED_FAULTS = [
  "NONE",
  "BUSINESS_DECLINE",
  "TECHNICAL_DECLINE",
  "TIMEOUT_AFTER_DEBIT_REVERSED",
  "TIMEOUT_AFTER_DEBIT",
  "CREDIT_FAILED_AFTER_DEBIT",
  "DEEMED_PENDING",
  "DELAYED_CREDIT",
  "DUPLICATE_DEBIT",
  "DUPLICATE_REQUEST",
  "MERCHANT_NOT_UPDATED",
  "MERCHANT_SHOWS_PAID_ON_FAILURE",
  "MISSING_AT_ACQUIRER",
  "MISSING_AT_SWITCH",
  "AMOUNT_MISMATCH",
  "SETTLEMENT_MISS",
  "REFUND_OK",
  "REFUND_NOT_CREDITED",
  "REFUND_NOT_IN_MERCHANT",
] as const;
export type InjectedFault = (typeof INJECTED_FAULTS)[number];

export const FAULT_LABELS: Record<InjectedFault, string> = {
  NONE: "Clean success",
  BUSINESS_DECLINE: "Business decline (e.g. insufficient funds)",
  TECHNICAL_DECLINE: "Technical decline before debit",
  TIMEOUT_AFTER_DEBIT_REVERSED: "Timeout after debit, auto-reversed",
  TIMEOUT_AFTER_DEBIT: "Timeout after debit, not reversed",
  CREDIT_FAILED_AFTER_DEBIT: "Beneficiary credit failed after debit",
  DEEMED_PENDING: "Deemed / pending at cutoff",
  DELAYED_CREDIT: "Delayed beneficiary credit",
  DUPLICATE_DEBIT: "Duplicate debit (same reference)",
  DUPLICATE_REQUEST: "Duplicate request (app retry)",
  MERCHANT_NOT_UPDATED: "Merchant callback lost",
  MERCHANT_SHOWS_PAID_ON_FAILURE: "Merchant marked paid on failed payment",
  MISSING_AT_ACQUIRER: "Record missing at acquirer",
  MISSING_AT_SWITCH: "Record missing at switch",
  AMOUNT_MISMATCH: "Amount altered at acquirer",
  SETTLEMENT_MISS: "Left out of settlement",
  REFUND_OK: "Refund processed cleanly",
  REFUND_NOT_CREDITED: "Refund not credited to customer",
  REFUND_NOT_IN_MERCHANT: "Refund missing in merchant books",
};

/** The exception category a correct engine should raise for each injected fault (null = none). */
export const EXPECTED_CATEGORY: Record<InjectedFault, ExceptionCategory | null> = {
  NONE: null,
  BUSINESS_DECLINE: null,
  TECHNICAL_DECLINE: null,
  TIMEOUT_AFTER_DEBIT_REVERSED: null,
  TIMEOUT_AFTER_DEBIT: "FAILED_BUT_DEBITED",
  CREDIT_FAILED_AFTER_DEBIT: "FAILED_BUT_DEBITED",
  DEEMED_PENDING: "DELAYED",
  DELAYED_CREDIT: "DELAYED",
  DUPLICATE_DEBIT: "DUPLICATE",
  DUPLICATE_REQUEST: "DUPLICATE",
  MERCHANT_NOT_UPDATED: "SUCCESS_MERCHANT_NOT_UPDATED",
  MERCHANT_SHOWS_PAID_ON_FAILURE: "STATUS_MISMATCH",
  MISSING_AT_ACQUIRER: "MISSING",
  MISSING_AT_SWITCH: "MISSING",
  AMOUNT_MISMATCH: "AMOUNT_MISMATCH",
  SETTLEMENT_MISS: "SETTLEMENT_MISMATCH",
  REFUND_OK: null,
  REFUND_NOT_CREDITED: "REFUND_MISMATCH",
  REFUND_NOT_IN_MERCHANT: "REFUND_MISMATCH",
};

const rate = z.number().min(0).max(0.5);

export const simulationConfigSchema = z.object({
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
  transactionCount: z.number().int().min(10).max(100_000),
  seed: z.number().int().min(1).max(2_147_483_647),
  methodMix: z
    .object({
      UPI: z.number().min(0).max(100),
      DEBIT_CARD: z.number().min(0).max(100),
      CREDIT_CARD: z.number().min(0).max(100),
      NEFT: z.number().min(0).max(100),
      RTGS: z.number().min(0).max(100),
    })
    .refine((m) => Object.values(m).some((v) => v > 0), "At least one payment method needs a non-zero share"),
  faultRates: z
    .object({
      businessDecline: rate,
      technicalDecline: rate,
      timeoutAfterDebit: rate,
      autoReversalShare: z.number().min(0).max(1),
      creditFailure: rate,
      deemedPending: rate,
      delayedCredit: rate,
      duplicateDebit: rate,
      duplicateRequest: rate,
      merchantNotUpdated: rate,
      merchantPaidOnFailure: rate,
      missingRecord: rate,
      amountMismatch: rate,
      settlementMiss: rate,
      refund: rate,
      refundFailure: z.number().min(0).max(1),
    })
    .refine((f) => {
      const total =
        f.businessDecline +
        f.technicalDecline +
        f.timeoutAfterDebit +
        f.creditFailure +
        f.deemedPending +
        f.delayedCredit +
        f.duplicateDebit +
        f.duplicateRequest +
        f.merchantNotUpdated +
        f.merchantPaidOnFailure +
        f.missingRecord +
        f.amountMismatch +
        f.settlementMiss;
      return total <= 0.9;
    }, "Combined fault rates must leave at least 10% clean transactions"),
});
export type SimulationConfig = z.infer<typeof simulationConfigSchema>;

export const SIMULATION_PRESETS: Record<string, { label: string; description: string; config: Omit<SimulationConfig, "businessDate" | "seed"> }> = {
  normal: {
    label: "Normal business day",
    description: "Typical decline and failure rates with occasional reconciliation breaks.",
    config: {
      transactionCount: 5_000,
      methodMix: { UPI: 80, DEBIT_CARD: 6, CREDIT_CARD: 8, NEFT: 5, RTGS: 1 },
      faultRates: {
        businessDecline: 0.04,
        technicalDecline: 0.008,
        timeoutAfterDebit: 0.006,
        autoReversalShare: 0.7,
        creditFailure: 0.002,
        deemedPending: 0.003,
        delayedCredit: 0.004,
        duplicateDebit: 0.001,
        duplicateRequest: 0.002,
        merchantNotUpdated: 0.004,
        merchantPaidOnFailure: 0.0005,
        missingRecord: 0.002,
        amountMismatch: 0.001,
        settlementMiss: 0.003,
        refund: 0.01,
        refundFailure: 0.2,
      },
    },
  },
  outage: {
    label: "Network outage",
    description: "A switch/bank degradation: many timeouts, deemed transactions and lost callbacks.",
    config: {
      transactionCount: 5_000,
      methodMix: { UPI: 85, DEBIT_CARD: 5, CREDIT_CARD: 6, NEFT: 3, RTGS: 1 },
      faultRates: {
        businessDecline: 0.04,
        technicalDecline: 0.08,
        timeoutAfterDebit: 0.05,
        autoReversalShare: 0.5,
        creditFailure: 0.01,
        deemedPending: 0.03,
        delayedCredit: 0.04,
        duplicateDebit: 0.004,
        duplicateRequest: 0.02,
        merchantNotUpdated: 0.02,
        merchantPaidOnFailure: 0.002,
        missingRecord: 0.005,
        amountMismatch: 0.001,
        settlementMiss: 0.005,
        refund: 0.01,
        refundFailure: 0.3,
      },
    },
  },
  festive: {
    label: "Festive peak",
    description: "High volume with more retries and refunds; small rise in every failure mode.",
    config: {
      transactionCount: 20_000,
      methodMix: { UPI: 82, DEBIT_CARD: 5, CREDIT_CARD: 10, NEFT: 2.5, RTGS: 0.5 },
      faultRates: {
        businessDecline: 0.05,
        technicalDecline: 0.015,
        timeoutAfterDebit: 0.01,
        autoReversalShare: 0.65,
        creditFailure: 0.003,
        deemedPending: 0.006,
        delayedCredit: 0.01,
        duplicateDebit: 0.002,
        duplicateRequest: 0.008,
        merchantNotUpdated: 0.008,
        merchantPaidOnFailure: 0.001,
        missingRecord: 0.003,
        amountMismatch: 0.001,
        settlementMiss: 0.004,
        refund: 0.025,
        refundFailure: 0.25,
      },
    },
  },
};

export type Stage =
  "INITIATED" | "SWITCH_RECEIVED" | "ISSUER_DEBIT" | "SWITCH_ROUTED" | "ACQUIRER_CREDIT" | "MERCHANT_NOTIFIED" | "SETTLEMENT" | "REVERSAL" | "REFUND";

export interface TimelineEvent {
  stage: Stage;
  status: "OK" | "FAILED" | "TIMEOUT" | "PENDING" | "SKIPPED";
  at: string;
  latencyMs: number;
  note?: string;
}

export interface SimTransaction {
  txnRef: string;
  parentRef: string | null;
  kind: "PAYMENT" | "REFUND";
  customerId: string;
  merchantId: string;
  amountPaise: number;
  method: PaymentMethod;
  initiatedAt: Date;
  issuingBank: string;
  acquiringBank: string;
  switchStatus: RecordStatus;
  bankStatus: RecordStatus;
  merchantStatus: RecordStatus | "NONE";
  settlementStatus: "SETTLED" | "UNSETTLED" | "NOT_APPLICABLE";
  refundStatus: "NONE" | "SUCCESS" | "PENDING" | "FAILED";
  injectedFault: InjectedFault;
  failureStage: Stage | null;
  timeline: TimelineEvent[];
}

export interface SimulationOutput {
  transactions: SimTransaction[];
  records: NormalizedRecord[];
  faultCounts: Partial<Record<InjectedFault, number>>;
}

const IST_OFFSET_MS = 330 * 60 * 1000;

const AMOUNT_PROFILE: Record<PaymentMethod, { median: number; sigma: number; min: number; max: number; wholeRupees: number }> = {
  UPI: { median: 250, sigma: 1.3, min: 1, max: 1_00_000, wholeRupees: 0.8 },
  DEBIT_CARD: { median: 1_500, sigma: 1.1, min: 10, max: 2_00_000, wholeRupees: 0.3 },
  CREDIT_CARD: { median: 2_200, sigma: 1.2, min: 10, max: 5_00_000, wholeRupees: 0.3 },
  NEFT: { median: 25_000, sigma: 1.4, min: 1, max: 50_00_000, wholeRupees: 0.7 },
  RTGS: { median: 8_00_000, sigma: 1.0, min: 2_00_000, max: 5_00_00_000, wholeRupees: 0.9 },
};

const LATENCY_MS: Record<PaymentMethod, number> = { UPI: 350, DEBIT_CARD: 600, CREDIT_CARD: 600, NEFT: 25 * 60_000, RTGS: 4 * 60_000 };

function sampleAmountPaise(rng: Rng, method: PaymentMethod): number {
  const p = AMOUNT_PROFILE[method];
  let rupees = Math.min(Math.max(rng.logNormal(p.median, p.sigma), p.min), p.max);
  if (rng.chance(p.wholeRupees)) rupees = Math.round(rupees);
  return Math.max(Math.round(rupees * 100), 100);
}

/** A business-day timestamp in IST, weighted towards daytime hours. */
function sampleTimestamp(rng: Rng, businessDate: string): Date {
  const [y, m, d] = businessDate.split("-").map(Number);
  const startUtc = Date.UTC(y, m - 1, d) - IST_OFFSET_MS;
  const hourWeights = [1, 0.5, 0.3, 0.2, 0.2, 0.4, 1, 2, 4, 6, 7, 7, 7, 6, 6, 6, 6, 7, 8, 9, 9, 7, 4, 2];
  const hour = Number(rng.weighted(Object.fromEntries(hourWeights.map((w, i) => [String(i), w]))));
  // Keep the last hour clear of the cutoff so "late" effects come only from injected faults.
  const minute = hour === 23 ? rng.int(0, 29) : rng.int(0, 59);
  return new Date(startUtc + hour * 3_600_000 + minute * 60_000 + rng.int(0, 59_999));
}

class RefFactory {
  private seq: number;
  private readonly yy: string;
  private readonly ddd: string;
  private readonly ymd: string;

  constructor(businessDate: string, seed: number) {
    // Offset by seed so two simulations of the same day rarely share references.
    this.seq = (seed * 7919) % 900_000;
    const [y, m, d] = businessDate.split("-").map(Number);
    const dayOfYear = Math.floor((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 0)) / 86_400_000);
    this.yy = String(y).slice(-2);
    this.ddd = String(dayOfYear).padStart(3, "0");
    this.ymd = businessDate.replaceAll("-", "");
  }

  next(method: PaymentMethod, bank: string, at: Date): string {
    this.seq++;
    const hh = String(new Date(at.getTime() + IST_OFFSET_MS).getUTCHours()).padStart(2, "0");
    switch (method) {
      case "NEFT":
        return `${bank}N${this.yy.slice(-1)}${this.ddd}${String(this.seq).padStart(7, "0")}`;
      case "RTGS":
        return `${bank}R5${this.ymd}${String(this.seq).padStart(8, "0")}`;
      default:
        // RRN-like: Y DDD HH NNNNNN (12 digits)
        return `${this.yy.slice(-1)}${this.ddd}${hh}${String(this.seq % 1_000_000).padStart(6, "0")}`;
    }
  }

  refund(): string {
    this.seq++;
    return `RF${this.yy}${this.ddd}${String(this.seq).padStart(9, "0")}`;
  }
}

function pickFault(rng: Rng, f: SimulationConfig["faultRates"], method: PaymentMethod): InjectedFault {
  const roll = rng.next();
  let acc = 0;
  const table: [InjectedFault, number][] = [
    ["BUSINESS_DECLINE", f.businessDecline],
    ["TECHNICAL_DECLINE", f.technicalDecline],
    ["TIMEOUT_AFTER_DEBIT", f.timeoutAfterDebit],
    ["CREDIT_FAILED_AFTER_DEBIT", f.creditFailure],
    ["DEEMED_PENDING", f.deemedPending],
    ["DELAYED_CREDIT", f.delayedCredit],
    ["DUPLICATE_DEBIT", f.duplicateDebit],
    ["DUPLICATE_REQUEST", method === "UPI" || method === "DEBIT_CARD" || method === "CREDIT_CARD" ? f.duplicateRequest : 0],
    ["MERCHANT_NOT_UPDATED", f.merchantNotUpdated],
    ["MERCHANT_SHOWS_PAID_ON_FAILURE", f.merchantPaidOnFailure],
    ["MISSING_AT_ACQUIRER", f.missingRecord / 2],
    ["MISSING_AT_SWITCH", f.missingRecord / 2],
    ["AMOUNT_MISMATCH", f.amountMismatch],
    ["SETTLEMENT_MISS", f.settlementMiss],
  ];
  for (const [fault, p] of table) {
    acc += p;
    if (roll < acc) {
      if (fault === "TIMEOUT_AFTER_DEBIT" && rng.chance(f.autoReversalShare)) return "TIMEOUT_AFTER_DEBIT_REVERSED";
      return fault;
    }
  }
  return "NONE";
}

interface ParticipantViews {
  switch?: RecordStatus;
  issuer?: RecordStatus;
  issuerCount: number;
  acquirer?: RecordStatus;
  acquirerAmount?: number;
  merchant?: RecordStatus;
  settlement?: RecordStatus;
  reversal?: boolean;
  acquirerMissing?: boolean;
  switchMissing?: boolean;
  creditDelayMs: number;
}

/** The switch: walks a payment through each hop and applies the injected fault. */
export function routePayment(
  rng: Rng,
  method: PaymentMethod,
  amountPaise: number,
  start: Date,
  fault: InjectedFault,
): { views: ParticipantViews; timeline: TimelineEvent[]; failureStage: Stage | null } {
  const timeline: TimelineEvent[] = [];
  let clock = start.getTime();
  const hop = (stage: Stage, status: TimelineEvent["status"], baseLatency: number, note?: string) => {
    const latency = Math.max(20, Math.round(baseLatency * (0.5 + rng.next())));
    clock += latency;
    timeline.push({ stage, status, at: new Date(clock).toISOString(), latencyMs: latency, note });
  };
  const base = LATENCY_MS[method];
  const views: ParticipantViews = { issuerCount: 1, creditDelayMs: 0 };
  let failureStage: Stage | null = null;

  timeline.push({ stage: "INITIATED", status: "OK", at: start.toISOString(), latencyMs: 0 });
  hop("SWITCH_RECEIVED", "OK", base * 0.2);
  views.switch = "SUCCESS";

  if (fault === "TECHNICAL_DECLINE") {
    hop("ISSUER_DEBIT", "FAILED", base * 0.4, "Issuer bank unavailable (technical decline)");
    views.switch = "FAILED";
    views.issuer = undefined;
    return { views, timeline, failureStage: "ISSUER_DEBIT" };
  }
  if (fault === "BUSINESS_DECLINE") {
    hop("ISSUER_DEBIT", "FAILED", base * 0.4, "Declined: insufficient funds / limit exceeded");
    views.switch = "FAILED";
    views.issuer = "FAILED";
    return { views, timeline, failureStage: "ISSUER_DEBIT" };
  }

  hop("ISSUER_DEBIT", "OK", base * 0.4);
  views.issuer = "SUCCESS";
  if (fault === "DUPLICATE_DEBIT") {
    views.issuerCount = 2;
    timeline[timeline.length - 1].note = "Retry processed twice by issuer (same reference)";
  }

  if (fault === "TIMEOUT_AFTER_DEBIT" || fault === "TIMEOUT_AFTER_DEBIT_REVERSED") {
    hop("SWITCH_ROUTED", "TIMEOUT", base * 30, "No response from beneficiary bank; switch timed out");
    views.switch = "FAILED";
    failureStage = "SWITCH_ROUTED";
    if (fault === "TIMEOUT_AFTER_DEBIT_REVERSED") {
      hop("REVERSAL", "OK", base * 100, "Auto-reversal credited to customer");
      views.reversal = true;
    }
    return { views, timeline, failureStage };
  }

  hop("SWITCH_ROUTED", "OK", base * 0.2);

  if (fault === "CREDIT_FAILED_AFTER_DEBIT") {
    hop("ACQUIRER_CREDIT", "FAILED", base * 0.5, "Beneficiary account frozen / invalid");
    views.acquirer = "FAILED";
    views.switch = "FAILED";
    return { views, timeline, failureStage: "ACQUIRER_CREDIT" };
  }
  if (fault === "MERCHANT_SHOWS_PAID_ON_FAILURE") {
    hop("ACQUIRER_CREDIT", "FAILED", base * 0.5, "Credit failed at beneficiary bank");
    views.acquirer = "FAILED";
    views.switch = "FAILED";
    views.issuer = "SUCCESS";
    views.reversal = true;
    hop("REVERSAL", "OK", base * 50, "Customer debit reversed");
    hop("MERCHANT_NOTIFIED", "OK", base * 0.3, "Merchant optimistically marked order as paid");
    views.merchant = "SUCCESS";
    return { views, timeline, failureStage: "MERCHANT_NOTIFIED" };
  }
  if (fault === "DEEMED_PENDING") {
    hop("ACQUIRER_CREDIT", "PENDING", base * 30, "Beneficiary bank response pending (deemed)");
    views.acquirer = "PENDING";
    views.switch = "PENDING";
    hop("MERCHANT_NOTIFIED", "PENDING", base * 0.3, "Merchant told payment is pending");
    views.merchant = "PENDING";
    return { views, timeline, failureStage: "ACQUIRER_CREDIT" };
  }

  if (fault === "DELAYED_CREDIT") {
    const delay = (method === "NEFT" ? 3 * 60 : method === "RTGS" ? 50 : 25) * 60_000 * (1 + rng.next());
    views.creditDelayMs = delay;
    clock += delay;
    hop("ACQUIRER_CREDIT", "OK", base * 0.5, `Credit delayed by ${Math.round(delay / 60_000)} minutes`);
    failureStage = "ACQUIRER_CREDIT";
  } else {
    hop("ACQUIRER_CREDIT", "OK", base * 0.5);
  }
  views.acquirer = "SUCCESS";
  views.acquirerAmount = amountPaise;
  if (fault === "AMOUNT_MISMATCH") {
    const delta = Math.max(100, Math.round(amountPaise * (0.01 + rng.next() * 0.1)));
    views.acquirerAmount = amountPaise - delta;
    timeline[timeline.length - 1].note = "Acquirer recorded a different amount (partial capture / data error)";
    failureStage = "ACQUIRER_CREDIT";
  }

  if (fault === "MERCHANT_NOT_UPDATED") {
    hop("MERCHANT_NOTIFIED", "FAILED", base * 0.3, "Merchant callback not delivered");
    views.merchant = rng.chance(0.5) ? "FAILED" : undefined;
    failureStage = "MERCHANT_NOTIFIED";
  } else {
    hop("MERCHANT_NOTIFIED", "OK", base * 0.3);
    views.merchant = "SUCCESS";
  }

  if (fault === "SETTLEMENT_MISS") {
    timeline.push({
      stage: "SETTLEMENT",
      status: "SKIPPED",
      at: new Date(clock + 3_600_000).toISOString(),
      latencyMs: 3_600_000,
      note: "Not included in settlement cycle",
    });
    views.settlement = rng.chance(0.5) ? "FAILED" : undefined;
    failureStage = "SETTLEMENT";
  } else {
    timeline.push({ stage: "SETTLEMENT", status: "OK", at: new Date(clock + 3_600_000).toISOString(), latencyMs: 3_600_000 });
    views.settlement = "SUCCESS";
  }

  if (fault === "MISSING_AT_ACQUIRER") {
    views.acquirerMissing = true;
    failureStage = "ACQUIRER_CREDIT";
  }
  if (fault === "MISSING_AT_SWITCH") {
    views.switchMissing = true;
    failureStage = "SWITCH_RECEIVED";
  }
  return { views, timeline, failureStage };
}

export function simulate(config: SimulationConfig): SimulationOutput {
  const rng = new Rng(config.seed);
  const refs = new RefFactory(config.businessDate, config.seed);
  const transactions: SimTransaction[] = [];
  const records: NormalizedRecord[] = [];
  const faultCounts: Partial<Record<InjectedFault, number>> = {};
  const customerPool = Math.max(1_000, Math.floor(config.transactionCount / 2));
  const merchantPool = Math.max(50, Math.min(2_000, Math.floor(config.transactionCount / 20)));
  const count = (fault: InjectedFault) => (faultCounts[fault] = (faultCounts[fault] ?? 0) + 1);

  const methods = Object.fromEntries(PAYMENT_METHODS.map((m) => [m, config.methodMix[m]])) as Record<PaymentMethod, number>;

  const add = (
    source: SourceSystem,
    base: Omit<NormalizedRecord, "source" | "status" | "eventAt" | "amountPaise">,
    status: RecordStatus,
    eventAt: Date,
    amountPaise: number,
  ) => records.push({ ...base, source, status, eventAt, amountPaise });

  for (let i = 0; i < config.transactionCount; i++) {
    const method = rng.weighted(methods);
    const issuer = rng.pick(BANKS);
    const acquirer = rng.pick(BANKS);
    const start = sampleTimestamp(rng, config.businessDate);
    const amountPaise = sampleAmountPaise(rng, method);
    const customerId = `CUST${String(rng.int(1, customerPool)).padStart(7, "0")}`;
    const merchantId = `MER${String(rng.int(1, merchantPool)).padStart(6, "0")}`;
    const fault = pickFault(rng, config.faultRates, method);
    const attempts = fault === "DUPLICATE_REQUEST" ? 2 : 1;

    for (let attempt = 0; attempt < attempts; attempt++) {
      const at = attempt === 0 ? start : new Date(start.getTime() + rng.int(20, 240) * 1000);
      const txnRef = refs.next(method, issuer.code, at);
      const thisFault: InjectedFault = attempt === 1 ? "DUPLICATE_REQUEST" : fault === "DUPLICATE_REQUEST" ? "NONE" : fault;
      count(thisFault);
      const { views, timeline, failureStage } = routePayment(rng, method, amountPaise, at, thisFault);
      const t = (stage: Stage) => new Date(timeline.find((e) => e.stage === stage)?.at ?? at.toISOString());
      const base = {
        txnRef,
        parentRef: null,
        recordType: "PAYMENT" as const,
        method,
        customerId,
        merchantId,
        issuingBank: issuer.code,
        acquiringBank: acquirer.code,
      };

      if (views.switch && !views.switchMissing) add("SWITCH", base, views.switch, t("SWITCH_RECEIVED"), amountPaise);
      if (views.issuer) {
        for (let k = 0; k < views.issuerCount; k++) add("ISSUER", base, views.issuer, t("ISSUER_DEBIT"), amountPaise);
      }
      if (views.reversal) {
        add("ISSUER", { ...base, txnRef: `${txnRef}R`, parentRef: txnRef, recordType: "REVERSAL" }, "SUCCESS", t("REVERSAL"), amountPaise);
      }
      if (views.acquirer && !views.acquirerMissing) add("ACQUIRER", base, views.acquirer, t("ACQUIRER_CREDIT"), views.acquirerAmount ?? amountPaise);
      if (views.merchant) add("MERCHANT", base, views.merchant, t("MERCHANT_NOTIFIED"), amountPaise);
      if (views.settlement) add("SETTLEMENT", base, views.settlement, t("SETTLEMENT"), views.acquirerAmount ?? amountPaise);

      const success = views.acquirer === "SUCCESS";
      transactions.push({
        txnRef,
        parentRef: null,
        kind: "PAYMENT",
        customerId,
        merchantId,
        amountPaise,
        method,
        initiatedAt: at,
        issuingBank: issuer.code,
        acquiringBank: acquirer.code,
        switchStatus: views.switch ?? "FAILED",
        bankStatus: views.reversal ? "REVERSED" : (views.issuer ?? "FAILED"),
        merchantStatus: views.merchant ?? "NONE",
        settlementStatus: success ? (views.settlement === "SUCCESS" ? "SETTLED" : "UNSETTLED") : "NOT_APPLICABLE",
        refundStatus: "NONE",
        injectedFault: thisFault,
        failureStage,
        timeline,
      });

      // Refunds on a share of clean successful payments.
      if (thisFault === "NONE" && success && method !== "RTGS" && rng.chance(config.faultRates.refund)) {
        const refundFault: InjectedFault = rng.chance(config.faultRates.refundFailure)
          ? rng.chance(0.5)
            ? "REFUND_NOT_CREDITED"
            : "REFUND_NOT_IN_MERCHANT"
          : "REFUND_OK";
        count(refundFault);
        const refundRef = refs.refund();
        const refundAt = new Date(at.getTime() + rng.int(10, 120) * 60_000);
        const refundAmount = rng.chance(0.7) ? amountPaise : Math.max(100, Math.round(amountPaise * (0.2 + rng.next() * 0.6)));
        const rbase = { ...base, txnRef: refundRef, parentRef: txnRef, recordType: "REFUND" as const };
        const creditedAt = new Date(refundAt.getTime() + rng.int(1, 30) * 60_000);
        if (refundFault !== "REFUND_NOT_IN_MERCHANT") add("MERCHANT", rbase, "SUCCESS", refundAt, refundAmount);
        if (refundFault !== "REFUND_NOT_CREDITED") add("ISSUER", rbase, "SUCCESS", creditedAt, refundAmount);
        transactions[transactions.length - 1].refundStatus = refundFault === "REFUND_NOT_CREDITED" ? "PENDING" : "SUCCESS";
        transactions.push({
          txnRef: refundRef,
          parentRef: txnRef,
          kind: "REFUND",
          customerId,
          merchantId,
          amountPaise: refundAmount,
          method,
          initiatedAt: refundAt,
          issuingBank: issuer.code,
          acquiringBank: acquirer.code,
          switchStatus: "SUCCESS",
          bankStatus: refundFault === "REFUND_NOT_CREDITED" ? "PENDING" : "SUCCESS",
          merchantStatus: refundFault === "REFUND_NOT_IN_MERCHANT" ? "NONE" : "SUCCESS",
          settlementStatus: "NOT_APPLICABLE",
          refundStatus: refundFault === "REFUND_NOT_CREDITED" ? "PENDING" : "SUCCESS",
          injectedFault: refundFault,
          failureStage: refundFault === "REFUND_OK" ? null : "REFUND",
          timeline: [
            { stage: "REFUND", status: "OK", at: refundAt.toISOString(), latencyMs: 0, note: "Merchant initiated refund" },
            {
              stage: "REFUND",
              status: refundFault === "REFUND_NOT_CREDITED" ? "PENDING" : "OK",
              at: creditedAt.toISOString(),
              latencyMs: creditedAt.getTime() - refundAt.getTime(),
              note:
                refundFault === "REFUND_NOT_CREDITED"
                  ? "Credit to customer not received"
                  : refundFault === "REFUND_NOT_IN_MERCHANT"
                    ? "Credited, but merchant ledger not updated"
                    : "Credited to customer",
            },
          ],
        });
      }
    }
  }

  return { transactions, records, faultCounts };
}
