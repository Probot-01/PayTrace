import type { ExceptionCategory, PaymentMethod } from "../types";

/**
 * Turn-around-time (TAT) and customer compensation rules.
 *
 * Regulatory rules come from RBI circular RBI/2019-20/67 (DPSS.CO.PD No.629/02.01.014/2019-20,
 * 20 Sep 2019) "Harmonisation of TAT and customer compensation for failed transactions", and the
 * RBI NEFT/RTGS customer rules (B+2 hours return for NEFT, 1 hour return for RTGS, penal interest
 * at repo + 2%). T is the calendar date of the transaction in IST.
 *
 * Where no regulatory TAT applies (refunds, settlement breaks, data issues), an internal SLA is
 * used and labelled as such so operators never confuse the two.
 */

const IST_OFFSET_MS = 330 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export type Compensation =
  | { kind: "FLAT_PER_DAY"; paisePerDay: number }
  | { kind: "PENAL_INTEREST"; spreadBps: number }
  | { kind: "NONE" };

export interface TatRule {
  dueAt: Date;
  basis: "RBI" | "INTERNAL";
  description: string;
  compensation: Compensation;
}

/** End of the IST calendar day that is `plusDays` after the IST date of `at`. */
export function endOfIstDay(at: Date, plusDays: number): Date {
  const ist = new Date(at.getTime() + IST_OFFSET_MS);
  const endIst = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + plusDays + 1) - 1;
  return new Date(endIst - IST_OFFSET_MS);
}

/** The IST calendar date (YYYY-MM-DD) of an instant. */
export function istDate(at: Date): string {
  return new Date(at.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

const FLAT_100 = { kind: "FLAT_PER_DAY", paisePerDay: 100_00 } as const;
const PENAL = { kind: "PENAL_INTEREST", spreadBps: 200 } as const;
const NONE = { kind: "NONE" } as const;

function tPlus(txnAt: Date, days: number, basis: TatRule["basis"], description: string, compensation: Compensation): TatRule {
  return { dueAt: endOfIstDay(txnAt, days), basis, description, compensation };
}

export function tatFor(category: ExceptionCategory, method: PaymentMethod, txnAt: Date): TatRule {
  const isCard = method === "DEBIT_CARD" || method === "CREDIT_CARD";

  switch (category) {
    case "FAILED_BUT_DEBITED":
    case "DUPLICATE":
      if (method === "UPI")
        return tPlus(txnAt, 1, "RBI", "UPI: beneficiary not credited, reverse by T+1; ₹100/day beyond", FLAT_100);
      if (isCard)
        return tPlus(txnAt, 5, "RBI", "Card: confirmation not received at merchant, auto-reverse within T+5; ₹100/day beyond", FLAT_100);
      if (method === "NEFT")
        return {
          dueAt: new Date(txnAt.getTime() + 2 * HOUR_MS),
          basis: "RBI",
          description: "NEFT: credit or return within B+2 hours; penal interest at repo + 2%",
          compensation: PENAL,
        };
      return {
        dueAt: new Date(txnAt.getTime() + 1 * HOUR_MS),
        basis: "RBI",
        description: "RTGS: return within 1 hour of receipt; penal interest at repo + 2%",
        compensation: PENAL,
      };

    case "SUCCESS_MERCHANT_NOT_UPDATED":
      if (method === "UPI")
        return tPlus(txnAt, 5, "RBI", "UPI merchant payment: confirmation not received, auto-reverse within T+5; ₹100/day beyond", FLAT_100);
      if (isCard)
        return tPlus(txnAt, 5, "RBI", "Card: charge slip / confirmation not generated, auto-reverse within T+5; ₹100/day beyond", FLAT_100);
      return tPlus(txnAt, 1, "INTERNAL", "Beneficiary credited; merchant ledger to be synced by T+1", NONE);

    case "DELAYED":
      if (method === "NEFT" || method === "RTGS")
        return {
          dueAt: new Date(txnAt.getTime() + (method === "NEFT" ? 2 : 1) * HOUR_MS),
          basis: "RBI",
          description: method === "NEFT" ? "NEFT: credit within 2 hours of batch settlement" : "RTGS: credit within 30 minutes, return within 1 hour",
          compensation: PENAL,
        };
      return tPlus(txnAt, 1, "INTERNAL", "Uncertain state: obtain final status by T+1", NONE);

    case "REFUND_MISMATCH":
      return tPlus(txnAt, 5, "INTERNAL", "Refund to be reflected at customer and merchant within T+5", NONE);

    case "SETTLEMENT_MISMATCH":
      return tPlus(txnAt, 2, "INTERNAL", "Settlement break to be adjusted in the next cycle (T+2)", NONE);

    default:
      return tPlus(txnAt, 2, "INTERNAL", "Investigate and correct records by T+2", NONE);
  }
}

/**
 * Compensation owed to the customer if the exception is (or was) still unresolved at `asOf`.
 * Flat compensation is per started day of delay; penal interest accrues pro rata on the amount.
 */
export function accruedCompensationPaise(
  rule: Pick<TatRule, "dueAt" | "compensation">,
  amountPaise: number,
  asOf: Date,
  repoRateBps: number,
): number {
  const lateMs = asOf.getTime() - rule.dueAt.getTime();
  if (lateMs <= 0) return 0;
  switch (rule.compensation.kind) {
    case "FLAT_PER_DAY":
      return Math.ceil(lateMs / DAY_MS) * rule.compensation.paisePerDay;
    case "PENAL_INTEREST": {
      const annualRate = (repoRateBps + rule.compensation.spreadBps) / 10_000;
      return Math.round((amountPaise * annualRate * lateMs) / (365 * DAY_MS));
    }
    default:
      return 0;
  }
}
