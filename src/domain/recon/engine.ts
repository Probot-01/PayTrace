import {
  SOURCE_SYSTEMS,
  type ExceptionCategory,
  type NormalizedRecord,
  type PaymentMethod,
  type RecordStatus,
  type Severity,
  type SourceSystem,
  SOURCE_SHORT_LABELS,
} from "../types";

/**
 * The reconciliation engine: a pure function from normalised participant records to per-transaction
 * outcomes and classified exceptions. It has no I/O so it can be unit-tested exhaustively and run
 * inside a worker over large batches.
 */

export interface ReconConfig {
  /** Amount differences at or below this are treated as equal (rounding noise). */
  amountTolerancePaise: number;
  /** Same customer + merchant + amount + method debited twice within this window is a suspected duplicate. */
  duplicateWindowMinutes: number;
  /** Maximum expected lag between the switch response and the beneficiary credit. */
  creditSlaMinutes: Record<PaymentMethod, number>;
  /** Affected value at or above this is CRITICAL and always needs a human. */
  highValuePaise: number;
}

export const DEFAULT_RECON_CONFIG: ReconConfig = {
  amountTolerancePaise: 0,
  duplicateWindowMinutes: 10,
  creditSlaMinutes: { UPI: 5, DEBIT_CARD: 15, CREDIT_CARD: 15, NEFT: 120, RTGS: 30 },
  highValuePaise: 2_00_000_00, // ₹2,00,000 (RTGS floor)
};

export interface EvidenceRecord {
  source: SourceSystem;
  recordType: NormalizedRecord["recordType"];
  txnRef: string;
  status: RecordStatus;
  amountPaise: number;
  eventAt: string;
  count: number;
}

export interface DetectedException {
  txnRef: string;
  category: ExceptionCategory;
  method: PaymentMethod;
  amountPaise: number;
  affectedPaise: number;
  severity: Severity;
  failurePoint: SourceSystem | null;
  suspectedCause: string;
  recommendedAction: string;
  requiresManual: boolean;
  txnAt: Date;
  evidence: {
    records: EvidenceRecord[];
    missingSources?: SourceSystem[];
    relatedRefs?: string[];
    rule: string;
  };
}

export type TxnOutcome = "SUCCESS" | "FAILED" | "PENDING";

export interface TxnResult {
  txnRef: string;
  method: PaymentMethod;
  amountPaise: number;
  outcome: TxnOutcome;
  matched: boolean;
  isRefund: boolean;
  sourcesPresent: SourceSystem[];
  exceptionCount: number;
  txnAt: Date;
  customerId: string | null;
  merchantId: string | null;
}

export interface ReconStats {
  totalTransactions: number;
  successful: number;
  failed: number;
  pending: number;
  matched: number;
  reconciliationRate: number;
  totalValuePaise: number;
  refunds: number;
  refundsMatched: number;
  exceptions: number;
  affectedValuePaise: number;
  manualReview: number;
  byCategory: Partial<Record<ExceptionCategory, { count: number; affectedPaise: number }>>;
  byMethod: Partial<Record<PaymentMethod, { total: number; matched: number; exceptions: number }>>;
  recordsProcessed: number;
}

export interface ReconResult {
  transactions: TxnResult[];
  exceptions: DetectedException[];
  stats: ReconStats;
}

type SourceMap = Partial<Record<SourceSystem, NormalizedRecord[]>>;

interface PaymentGroup {
  ref: string;
  payments: SourceMap;
  reversals: NormalizedRecord[];
}

const SEVERITY_ORDER: Severity[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

const BASE_SEVERITY: Record<ExceptionCategory, Severity> = {
  FAILED_BUT_DEBITED: "HIGH",
  DUPLICATE: "HIGH",
  AMOUNT_MISMATCH: "HIGH",
  MISSING: "MEDIUM",
  STATUS_MISMATCH: "MEDIUM",
  SUCCESS_MERCHANT_NOT_UPDATED: "MEDIUM",
  REFUND_MISMATCH: "MEDIUM",
  SETTLEMENT_MISMATCH: "MEDIUM",
  DELAYED: "LOW",
};

/** Categories with a deterministic playbook that can be actioned without investigation. */
const AUTO_ACTIONABLE = new Set<ExceptionCategory>(["DELAYED", "SUCCESS_MERCHANT_NOT_UPDATED", "FAILED_BUT_DEBITED"]);

export function severityFor(category: ExceptionCategory, affectedPaise: number, config: ReconConfig): Severity {
  if (affectedPaise >= config.highValuePaise) return "CRITICAL";
  let index = SEVERITY_ORDER.indexOf(BASE_SEVERITY[category]);
  if (affectedPaise >= config.highValuePaise / 10) index = Math.min(index + 1, SEVERITY_ORDER.length - 1);
  return SEVERITY_ORDER[index];
}

function first(map: SourceMap, source: SourceSystem): NormalizedRecord | undefined {
  return map[source]?.[0];
}

function toEvidence(map: SourceMap, extra: NormalizedRecord[] = []): EvidenceRecord[] {
  const out: EvidenceRecord[] = [];
  for (const source of SOURCE_SYSTEMS) {
    const recs = map[source];
    if (!recs?.length) continue;
    const r = recs[0];
    out.push({
      source,
      recordType: r.recordType,
      txnRef: r.txnRef,
      status: r.status,
      amountPaise: r.amountPaise,
      eventAt: r.eventAt.toISOString(),
      count: recs.length,
    });
  }
  for (const r of extra) {
    out.push({
      source: r.source,
      recordType: r.recordType,
      txnRef: r.txnRef,
      status: r.status,
      amountPaise: r.amountPaise,
      eventAt: r.eventAt.toISOString(),
      count: 1,
    });
  }
  return out;
}

function pushTo(map: Map<string, SourceMap>, key: string, record: NormalizedRecord) {
  let group = map.get(key);
  if (!group) {
    group = {};
    map.set(key, group);
  }
  (group[record.source] ??= []).push(record);
}

function minutesBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / 60_000;
}

/** Earliest record in path order: the participant that saw the payment first. */
function anchorRecord(map: SourceMap): NormalizedRecord {
  for (const source of SOURCE_SYSTEMS) {
    const r = map[source]?.[0];
    if (r) return r;
  }
  throw new Error("empty group");
}

export function reconcile(records: NormalizedRecord[], config: ReconConfig = DEFAULT_RECON_CONFIG): ReconResult {
  const payments = new Map<string, PaymentGroup>();
  const reversalsByParent = new Map<string, NormalizedRecord[]>();
  const refunds = new Map<string, SourceMap>();

  for (const r of records) {
    if (r.recordType === "PAYMENT") {
      let g = payments.get(r.txnRef);
      if (!g) {
        g = { ref: r.txnRef, payments: {}, reversals: [] };
        payments.set(r.txnRef, g);
      }
      (g.payments[r.source] ??= []).push(r);
    } else if (r.recordType === "REVERSAL") {
      const key = r.parentRef ?? r.txnRef;
      const list = reversalsByParent.get(key) ?? [];
      list.push(r);
      reversalsByParent.set(key, list);
    } else {
      pushTo(refunds, r.txnRef, r);
    }
  }
  for (const [parent, revs] of reversalsByParent) {
    const g = payments.get(parent);
    if (g) g.reversals.push(...revs);
  }

  const exceptions: DetectedException[] = [];
  const transactions: TxnResult[] = [];
  const exceptionCountByRef = new Map<string, number>();
  const emitted = new Set<string>();

  const emit = (
    base: { ref: string; method: PaymentMethod; amountPaise: number; txnAt: Date },
    category: ExceptionCategory,
    detail: {
      affectedPaise: number;
      failurePoint: SourceSystem | null;
      cause: string;
      action: string;
      evidence: DetectedException["evidence"];
      forceManual?: boolean;
    },
  ) => {
    // One exception per (transaction, category); merge repeated findings into the first.
    const key = `${base.ref}|${category}`;
    if (emitted.has(key)) return;
    emitted.add(key);
    const severity = severityFor(category, detail.affectedPaise, config);
    exceptions.push({
      txnRef: base.ref,
      category,
      method: base.method,
      amountPaise: base.amountPaise,
      affectedPaise: detail.affectedPaise,
      severity,
      failurePoint: detail.failurePoint,
      suspectedCause: detail.cause,
      recommendedAction: detail.action,
      requiresManual: detail.forceManual === true || severity === "CRITICAL" || !AUTO_ACTIONABLE.has(category),
      txnAt: base.txnAt,
      evidence: detail.evidence,
    });
    exceptionCountByRef.set(base.ref, (exceptionCountByRef.get(base.ref) ?? 0) + 1);
  };

  // ---- Payments ----------------------------------------------------------------------------
  for (const group of payments.values()) {
    classifyPayment(group, config, emit);
  }

  // ---- Suspected duplicate requests (different references, same intent) -------------------
  detectSuspectedDuplicates(payments, config, emit);

  for (const group of payments.values()) {
    const anchor = anchorRecord(group.payments);
    const S = first(group.payments, "SWITCH");
    const I = first(group.payments, "ISSUER");
    const A = first(group.payments, "ACQUIRER");
    const outcome = outcomeOf(S, I, A);
    transactions.push({
      txnRef: group.ref,
      method: anchor.method,
      amountPaise: (S ?? I ?? anchor).amountPaise,
      outcome,
      matched: !exceptionCountByRef.get(group.ref),
      isRefund: false,
      sourcesPresent: SOURCE_SYSTEMS.filter((s) => group.payments[s]?.length),
      exceptionCount: exceptionCountByRef.get(group.ref) ?? 0,
      txnAt: anchor.eventAt,
      customerId: anchor.customerId,
      merchantId: anchor.merchantId,
    });
  }

  // ---- Refunds -------------------------------------------------------------------------------
  const refundedByParent = new Map<string, number>();
  for (const [ref, map] of refunds) {
    classifyRefund(ref, map, payments, refundedByParent, config, emit);
    const anchor = anchorRecord(map);
    const anyPending = SOURCE_SYSTEMS.some((s) => map[s]?.[0]?.status === "PENDING");
    const anySuccess = SOURCE_SYSTEMS.some((s) => map[s]?.[0]?.status === "SUCCESS");
    transactions.push({
      txnRef: ref,
      method: anchor.method,
      amountPaise: anchor.amountPaise,
      outcome: anyPending ? "PENDING" : anySuccess ? "SUCCESS" : "FAILED",
      matched: !exceptionCountByRef.get(ref),
      isRefund: true,
      sourcesPresent: SOURCE_SYSTEMS.filter((s) => map[s]?.length),
      exceptionCount: exceptionCountByRef.get(ref) ?? 0,
      txnAt: anchor.eventAt,
      customerId: anchor.customerId,
      merchantId: anchor.merchantId,
    });
  }

  return { transactions, exceptions, stats: computeStats(transactions, exceptions, records.length) };
}

function outcomeOf(S?: NormalizedRecord, I?: NormalizedRecord, A?: NormalizedRecord): TxnOutcome {
  const primary = S ?? A ?? I;
  if (!primary) return "FAILED";
  if ([S, I, A].some((r) => r?.status === "PENDING")) return "PENDING";
  return primary.status === "SUCCESS" ? "SUCCESS" : "FAILED";
}

type Emit = (
  base: { ref: string; method: PaymentMethod; amountPaise: number; txnAt: Date },
  category: ExceptionCategory,
  detail: {
    affectedPaise: number;
    failurePoint: SourceSystem | null;
    cause: string;
    action: string;
    evidence: DetectedException["evidence"];
    forceManual?: boolean;
  },
) => void;

function classifyPayment(group: PaymentGroup, config: ReconConfig, emit: Emit) {
  const map = group.payments;
  const S = first(map, "SWITCH");
  const I = first(map, "ISSUER");
  const A = first(map, "ACQUIRER");
  const M = first(map, "MERCHANT");
  const St = first(map, "SETTLEMENT");
  const anchor = anchorRecord(map);
  const amountPaise = (S ?? I ?? anchor).amountPaise;
  const base = { ref: group.ref, method: anchor.method, amountPaise, txnAt: anchor.eventAt };
  const evidence = (rule: string, extra: Partial<DetectedException["evidence"]> = {}) => ({
    records: toEvidence(map, group.reversals),
    rule,
    ...extra,
  });

  const reversed =
    I?.status === "REVERSED" || group.reversals.some((r) => r.status === "SUCCESS" || r.status === "REVERSED");
  const issuerDebited = I?.status === "SUCCESS" || I?.status === "REVERSED";
  const netDebited = I?.status === "SUCCESS" && !reversed;
  const credited = A?.status === "SUCCESS";
  const explained = new Set<SourceSystem>();

  // 1. Exact duplicates: the same reference recorded more than once by one participant.
  for (const source of SOURCE_SYSTEMS) {
    const recs = map[source];
    if (!recs || recs.length < 2) continue;
    const successful = recs.filter((r) => r.status === "SUCCESS");
    const extraCount = Math.max(successful.length - 1, 0);
    const causes: Record<SourceSystem, string> = {
      ISSUER: "Customer debited more than once for the same reference: a retried request was processed again instead of being treated as idempotent.",
      SWITCH: "The switch logged the same request more than once (duplicate request from the PSP/app).",
      ACQUIRER: "Beneficiary credited more than once for the same reference.",
      MERCHANT: "Merchant system recorded the same payment more than once.",
      SETTLEMENT: "The same transaction appears more than once in the settlement report.",
    };
    emit(base, "DUPLICATE", {
      affectedPaise: extraCount * recs[0].amountPaise,
      failurePoint: source,
      cause: causes[source],
      action:
        source === "ISSUER"
          ? "Reverse the extra debit to the customer and confirm the reversal in the next issuer file."
          : `Remove the duplicate entry at the ${SOURCE_SHORT_LABELS[source].toLowerCase()} and confirm a single record remains.`,
      evidence: evidence(`${recs.length} records with the same reference in ${source}`),
      forceManual: source !== "ISSUER",
    });
  }

  // 2. Amount mismatch across the transactional participants.
  const amountSources = (["SWITCH", "ISSUER", "ACQUIRER", "MERCHANT"] as const).filter((s) => map[s]?.length);
  if (amountSources.length > 1) {
    const reference = (S ?? I ?? anchor).amountPaise;
    const amounts = amountSources.map((s) => map[s]![0].amountPaise);
    const spread = Math.max(...amounts) - Math.min(...amounts);
    if (spread > config.amountTolerancePaise) {
      const offender = amountSources.find((s) => Math.abs(map[s]![0].amountPaise - reference) > config.amountTolerancePaise) ?? null;
      emit(base, "AMOUNT_MISMATCH", {
        affectedPaise: spread,
        failurePoint: offender,
        cause: `Participants disagree on the amount (difference ${spread / 100} INR). ${offender ? SOURCE_SHORT_LABELS[offender] : "One participant"} reports a different value; typical causes are partial capture, fee netting or a data entry/format error.`,
        action: "Confirm the authorised amount with the switch log and correct the participant that differs; adjust the customer or merchant for the difference.",
        evidence: evidence("Amounts differ across participants"),
      });
    }
  }

  // 3. Uncertain state at cutoff (timeouts / deemed / delayed responses).
  const pendingSource = (["SWITCH", "ISSUER", "ACQUIRER", "MERCHANT"] as const).find((s) => map[s]?.[0]?.status === "PENDING");
  if (pendingSource) {
    emit(base, "DELAYED", {
      affectedPaise: netDebited ? amountPaise : 0,
      failurePoint: pendingSource,
      cause: `${SOURCE_SHORT_LABELS[pendingSource]} still reports PENDING at reconciliation cutoff (timeout, deemed-approved or delayed response).${netDebited ? " The customer has already been debited." : ""}`,
      action:
        base.method === "UPI"
          ? "Do not reverse or re-push yet. Poll the final status (UPI: first status check no earlier than 90 seconds, at most 3 checks within 2 hours), then rely on the settlement file or UDIR."
          : "Obtain the final status from the network/bank; reverse to the customer if it does not complete within the TAT.",
      evidence: evidence(`${pendingSource} status PENDING`),
    });
    return; // Status-based rules are unreliable until the final status is known.
  }

  // 4. Late beneficiary credit (completed, but beyond the expected lag).
  if (S && A && credited && S.status === "SUCCESS") {
    const lag = minutesBetween(S.eventAt, A.eventAt);
    const sla = config.creditSlaMinutes[base.method];
    if (lag > sla) {
      emit(base, "DELAYED", {
        affectedPaise: 0,
        failurePoint: "ACQUIRER",
        cause: `Beneficiary credited ${Math.round(lag)} minutes after the switch response; the expected maximum for ${base.method} is ${sla} minutes.`,
        action: "No customer action needed. Track the acquiring bank's response latency; escalate if the pattern repeats.",
        evidence: evidence(`Credit lag ${Math.round(lag)} min > ${sla} min`),
      });
    }
  }

  // 5. Customer debited, beneficiary not credited, no reversal.
  const switchFailed = !S || S.status === "FAILED" || S.status === "REVERSED";
  if (netDebited && !credited && (A?.status === "FAILED" || switchFailed)) {
    const failurePoint: SourceSystem = A?.status === "FAILED" ? "ACQUIRER" : "SWITCH";
    emit(base, "FAILED_BUT_DEBITED", {
      affectedPaise: amountPaise,
      failurePoint,
      cause:
        failurePoint === "ACQUIRER"
          ? "Customer debited but the beneficiary bank rejected or failed the credit, and no reversal has been recorded."
          : S
            ? "Customer debited but the switch marked the transaction failed (typically a timeout after debit), and no reversal has been recorded."
            : "Customer debited but the switch has no record of the request (lost between issuer and switch), and no reversal has been recorded.",
      action: "Trigger auto-reversal to the customer within the RBI TAT and credit compensation automatically if the TAT is breached.",
      evidence: evidence("Issuer SUCCESS, acquirer not credited, no reversal"),
    });
    explained.add("SWITCH").add("ISSUER").add("ACQUIRER");
    if (!M || M.status !== "SUCCESS") explained.add("MERCHANT");
    if (!St) explained.add("SETTLEMENT");
  }

  // 6. Reversal issued although the beneficiary was credited (customer and merchant both have the money).
  if (reversed && credited) {
    emit(base, "STATUS_MISMATCH", {
      affectedPaise: amountPaise,
      failurePoint: "ISSUER",
      cause: "The customer's debit was reversed but the beneficiary was also credited, so the funds were paid out twice.",
      action: "Recover the amount from the beneficiary side (debit adjustment / chargeback) or cancel the reversal.",
      evidence: evidence("Reversal recorded while acquirer SUCCESS"),
      forceManual: true,
    });
    explained.add("ISSUER").add("ACQUIRER");
  }

  // 7. Paid and credited, but the merchant's system never learnt about it.
  if (credited && (netDebited || !I) && (!M || M.status === "FAILED")) {
    emit(base, "SUCCESS_MERCHANT_NOT_UPDATED", {
      affectedPaise: amountPaise,
      failurePoint: "MERCHANT",
      cause: M
        ? "Payment succeeded at the bank and switch but the merchant system recorded it as failed (callback/webhook lost or processed out of order)."
        : "Payment succeeded at the bank and switch but the merchant system has no record (callback/webhook not delivered).",
      action: "Re-send the payment status to the merchant (status push / webhook retry). If the order cannot be fulfilled, refund the customer within T+5.",
      evidence: evidence("Acquirer SUCCESS, merchant not SUCCESS"),
    });
    explained.add("MERCHANT");
  }

  // 8. Settlement breaks.
  const shouldSettle = credited && (netDebited || !I) && !reversed;
  if (St) {
    // When the acquirer record is missing, fall back to the switch's view of the credit.
    const creditFailed = A ? A.status !== "SUCCESS" : S?.status !== "SUCCESS";
    if (St.status === "SUCCESS" && creditFailed) {
      emit(base, "SETTLEMENT_MISMATCH", {
        affectedPaise: St.amountPaise,
        failurePoint: "SETTLEMENT",
        cause: "The settlement report settled a transaction that was not credited (failed or reversed elsewhere).",
        action: "Raise a settlement adjustment to claw back the amount in the next cycle.",
        evidence: evidence("Settled but not credited"),
        forceManual: true,
      });
    } else if (shouldSettle && St.status !== "SUCCESS") {
      emit(base, "SETTLEMENT_MISMATCH", {
        affectedPaise: amountPaise,
        failurePoint: "SETTLEMENT",
        cause: "A successful, credited transaction is marked unsettled in the settlement report.",
        action: "Include the transaction in the next settlement cycle or raise a settlement claim with the network.",
        evidence: evidence("Credited but unsettled"),
      });
    } else if (A && Math.abs(St.amountPaise - A.amountPaise) > config.amountTolerancePaise) {
      emit(base, "SETTLEMENT_MISMATCH", {
        affectedPaise: Math.abs(St.amountPaise - A.amountPaise),
        failurePoint: "SETTLEMENT",
        cause: "The settled amount differs from the amount credited to the beneficiary.",
        action: "Reconcile the settlement line against the network report and post an adjustment for the difference.",
        evidence: evidence("Settlement amount differs"),
      });
    }
    explained.add("SETTLEMENT");
  } else if (shouldSettle) {
    emit(base, "SETTLEMENT_MISMATCH", {
      affectedPaise: amountPaise,
      failurePoint: "SETTLEMENT",
      cause: "A successful transaction is missing from the settlement report.",
      action: "Check whether it fell into the next settlement cycle; if not, raise a settlement claim with the network.",
      evidence: evidence("Missing from settlement report"),
    });
    explained.add("SETTLEMENT");
  }

  // 9. Records missing at participants that should have one.
  const successFlow = credited || S?.status === "SUCCESS";
  const expected: SourceSystem[] = successFlow ? ["SWITCH", "ISSUER", "ACQUIRER", "MERCHANT"] : ["SWITCH"];
  const missing = expected.filter((s) => !map[s]?.length && !explained.has(s));
  if (missing.length) {
    emit(base, "MISSING", {
      affectedPaise: amountPaise,
      failurePoint: missing[0],
      cause: `No record at ${missing.map((s) => SOURCE_SHORT_LABELS[s].toLowerCase()).join(", ")} although other participants processed the transaction.${netDebited && !credited ? " The customer has been debited." : ""}`,
      action: "Request the missing record (or a fresh file) from the participant; if it never processed the payment, treat as failed and reverse.",
      evidence: evidence("Expected participant has no record", { missingSources: missing }),
    });
    missing.forEach((s) => explained.add(s));
  }

  // 10. Remaining status disagreements.
  const consensus: RecordStatus = successFlow ? "SUCCESS" : "FAILED";
  const conflicting = (["SWITCH", "ISSUER", "ACQUIRER", "MERCHANT"] as const).filter((s) => {
    const r = map[s]?.[0];
    if (!r || explained.has(s)) return false;
    const normalised: RecordStatus = r.status === "REVERSED" ? "FAILED" : r.status;
    if (s === "ISSUER" && consensus === "FAILED" && issuerDebited && reversed) return false;
    return normalised !== consensus;
  });
  if (conflicting.length) {
    emit(base, "STATUS_MISMATCH", {
      affectedPaise: amountPaise,
      failurePoint: conflicting[0],
      cause: `${conflicting.map((s) => SOURCE_SHORT_LABELS[s]).join(", ")} report${conflicting.length === 1 ? "s" : ""} a different final status than the rest of the chain (${consensus.toLowerCase()}).`,
      action:
        consensus === "FAILED" && conflicting.includes("MERCHANT")
          ? "Stop fulfilment: the merchant shows paid but funds never moved. Correct the merchant record."
          : "Confirm the final status with the switch and correct the participant that disagrees.",
      evidence: evidence("Participants disagree on final status"),
    });
  }
}

function detectSuspectedDuplicates(payments: Map<string, PaymentGroup>, config: ReconConfig, emit: Emit) {
  const buckets = new Map<string, NormalizedRecord[]>();
  for (const g of payments.values()) {
    const I = first(g.payments, "ISSUER");
    if (!I || I.status !== "SUCCESS" || !I.customerId || !I.merchantId) continue;
    if (g.reversals.length) continue;
    const key = `${I.customerId}|${I.merchantId}|${I.amountPaise}|${I.method}`;
    const list = buckets.get(key) ?? [];
    list.push(I);
    buckets.set(key, list);
  }
  const windowMs = config.duplicateWindowMinutes * 60_000;
  for (const list of buckets.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => a.eventAt.getTime() - b.eventAt.getTime());
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1];
      const cur = list[i];
      if (cur.eventAt.getTime() - prev.eventAt.getTime() > windowMs) continue;
      const g = payments.get(cur.txnRef)!;
      emit({ ref: cur.txnRef, method: cur.method, amountPaise: cur.amountPaise, txnAt: cur.eventAt }, "DUPLICATE", {
        affectedPaise: cur.amountPaise,
        failurePoint: "ISSUER",
        cause: `Suspected duplicate request: the same customer paid the same merchant the same amount ${Math.round((cur.eventAt.getTime() - prev.eventAt.getTime()) / 1000)} seconds after ${prev.txnRef}. Typical of a user or app retry after a slow response.`,
        action: "Confirm with the merchant whether two orders exist. If not, refund or reverse the second debit.",
        evidence: { records: toEvidence(g.payments), relatedRefs: [prev.txnRef], rule: "Same customer, merchant, amount within window" },
        forceManual: true,
      });
    }
  }
}

function classifyRefund(
  ref: string,
  map: SourceMap,
  payments: Map<string, PaymentGroup>,
  refundedByParent: Map<string, number>,
  config: ReconConfig,
  emit: Emit,
) {
  const anchor = anchorRecord(map);
  const M = first(map, "MERCHANT");
  const I = first(map, "ISSUER");
  const base = { ref, method: anchor.method, amountPaise: anchor.amountPaise, txnAt: anchor.eventAt };
  const parentRef = anchor.parentRef;
  const parent = parentRef ? payments.get(parentRef) : undefined;
  const records = toEvidence(map, parent ? Object.values(parent.payments).map((l) => l![0]) : []);
  const ev = (rule: string) => ({ records, rule, relatedRefs: parentRef ? [parentRef] : undefined });

  if (M?.status === "PENDING" || I?.status === "PENDING") {
    emit(base, "REFUND_MISMATCH", {
      affectedPaise: anchor.amountPaise,
      failurePoint: I?.status === "PENDING" ? "ISSUER" : "MERCHANT",
      cause: "Refund is still pending at cutoff: the customer has not received the money back yet (delayed refund).",
      action: "Chase the refund with the processing bank; credit the customer before the refund SLA.",
      evidence: ev("Refund PENDING"),
    });
    return;
  }
  if (M?.status === "SUCCESS" && (!I || I.status === "FAILED")) {
    emit(base, "REFUND_MISMATCH", {
      affectedPaise: M.amountPaise,
      failurePoint: "ISSUER",
      cause: I
        ? "The merchant initiated a refund but the customer's bank failed the credit."
        : "The merchant initiated a refund but no corresponding credit reached the customer's bank.",
      action: "Re-initiate the refund (UPI: through UDIR / refund API) and confirm credit to the customer.",
      evidence: ev("Merchant refund without issuer credit"),
    });
    return;
  }
  if (I?.status === "SUCCESS" && (!M || M.status !== "SUCCESS")) {
    emit(base, "REFUND_MISMATCH", {
      affectedPaise: I.amountPaise,
      failurePoint: "MERCHANT",
      cause: "The customer was refunded but the refund is not reflected in the merchant's records.",
      action: "Post the refund in the merchant ledger and update the order status so it is not refunded twice.",
      evidence: ev("Issuer refund credit not in merchant records"),
    });
    return;
  }
  if (M && I && Math.abs(M.amountPaise - I.amountPaise) > config.amountTolerancePaise) {
    emit(base, "REFUND_MISMATCH", {
      affectedPaise: Math.abs(M.amountPaise - I.amountPaise),
      failurePoint: "ISSUER",
      cause: "The refund amount credited to the customer differs from the amount the merchant refunded.",
      action: "Credit or recover the difference and correct the refund record.",
      evidence: ev("Refund amounts differ"),
    });
    return;
  }
  if (parentRef) {
    const parentAmount = parent ? (first(parent.payments, "SWITCH") ?? first(parent.payments, "ISSUER"))?.amountPaise : undefined;
    const refunded = (refundedByParent.get(parentRef) ?? 0) + anchor.amountPaise;
    refundedByParent.set(parentRef, refunded);
    if (parentAmount === undefined) {
      emit(base, "REFUND_MISMATCH", {
        affectedPaise: anchor.amountPaise,
        failurePoint: null,
        cause: `Refund references original payment ${parentRef}, which is not present in the reconciled files.`,
        action: "Locate the original payment (earlier cycle?) and confirm the refund is legitimate.",
        evidence: ev("Original payment not found"),
      });
    } else if (refunded > parentAmount) {
      emit(base, "REFUND_MISMATCH", {
        affectedPaise: refunded - parentAmount,
        failurePoint: "MERCHANT",
        cause: "Total refunds exceed the original payment amount.",
        action: "Stop further refunds and recover the excess from the customer or merchant.",
        evidence: ev("Refunds exceed original"),
        forceManual: true,
      });
    }
  }
}

function computeStats(transactions: TxnResult[], exceptions: DetectedException[], recordsProcessed: number): ReconStats {
  const payments = transactions.filter((t) => !t.isRefund);
  const refunds = transactions.filter((t) => t.isRefund);
  const byCategory: ReconStats["byCategory"] = {};
  const byMethod: ReconStats["byMethod"] = {};
  let affected = 0;
  let manual = 0;
  for (const e of exceptions) {
    const c = (byCategory[e.category] ??= { count: 0, affectedPaise: 0 });
    c.count++;
    c.affectedPaise += e.affectedPaise;
    affected += e.affectedPaise;
    if (e.requiresManual) manual++;
  }
  for (const t of transactions) {
    const m = (byMethod[t.method] ??= { total: 0, matched: 0, exceptions: 0 });
    m.total++;
    if (t.matched) m.matched++;
    m.exceptions += t.exceptionCount;
  }
  const matched = payments.filter((t) => t.matched).length;
  return {
    totalTransactions: payments.length,
    successful: payments.filter((t) => t.outcome === "SUCCESS").length,
    failed: payments.filter((t) => t.outcome === "FAILED").length,
    pending: payments.filter((t) => t.outcome === "PENDING").length,
    matched,
    reconciliationRate: payments.length ? matched / payments.length : 0,
    totalValuePaise: payments.reduce((sum, t) => sum + t.amountPaise, 0),
    refunds: refunds.length,
    refundsMatched: refunds.filter((t) => t.matched).length,
    exceptions: exceptions.length,
    affectedValuePaise: affected,
    manualReview: manual,
    byCategory,
    byMethod,
    recordsProcessed,
  };
}
