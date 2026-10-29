// Shared domain vocabulary. Pure TypeScript: safe to import from server, client and tests.

export const PAYMENT_METHODS = ["UPI", "DEBIT_CARD", "CREDIT_CARD", "NEFT", "RTGS"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  UPI: "UPI",
  DEBIT_CARD: "Debit card",
  CREDIT_CARD: "Credit card",
  NEFT: "NEFT",
  RTGS: "RTGS",
};

/**
 * The participants whose records are reconciled. Path order matters: it is the order a
 * payment travels (Customer → Switch → Issuer → Acquirer → Merchant → Settlement) and is
 * used to pinpoint the first point of failure.
 */
export const SOURCE_SYSTEMS = ["SWITCH", "ISSUER", "ACQUIRER", "MERCHANT", "SETTLEMENT"] as const;
export type SourceSystem = (typeof SOURCE_SYSTEMS)[number];

export const SOURCE_LABELS: Record<SourceSystem, string> = {
  SWITCH: "Payment switch / network",
  ISSUER: "Issuing (remitter) bank",
  ACQUIRER: "Acquiring (beneficiary) bank",
  MERCHANT: "Merchant system",
  SETTLEMENT: "Settlement report",
};

export const SOURCE_SHORT_LABELS: Record<SourceSystem, string> = {
  SWITCH: "Switch",
  ISSUER: "Issuer",
  ACQUIRER: "Acquirer",
  MERCHANT: "Merchant",
  SETTLEMENT: "Settlement",
};

export const RECORD_STATUSES = ["SUCCESS", "FAILED", "PENDING", "REVERSED"] as const;
export type RecordStatus = (typeof RECORD_STATUSES)[number];

export const RECORD_TYPES = ["PAYMENT", "REFUND", "REVERSAL"] as const;
export type RecordType = (typeof RECORD_TYPES)[number];

export const EXCEPTION_CATEGORIES = [
  "SUCCESS_MERCHANT_NOT_UPDATED",
  "FAILED_BUT_DEBITED",
  "DUPLICATE",
  "MISSING",
  "AMOUNT_MISMATCH",
  "STATUS_MISMATCH",
  "DELAYED",
  "REFUND_MISMATCH",
  "SETTLEMENT_MISMATCH",
] as const;
export type ExceptionCategory = (typeof EXCEPTION_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<ExceptionCategory, string> = {
  SUCCESS_MERCHANT_NOT_UPDATED: "Successful, merchant not updated",
  FAILED_BUT_DEBITED: "Failed but amount debited",
  DUPLICATE: "Duplicate transaction",
  MISSING: "Missing transaction",
  AMOUNT_MISMATCH: "Amount mismatch",
  STATUS_MISMATCH: "Status mismatch",
  DELAYED: "Delayed transaction",
  REFUND_MISMATCH: "Refund mismatch",
  SETTLEMENT_MISMATCH: "Settlement mismatch",
};

export const SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const EXCEPTION_STATUSES = [
  "OPEN",
  "IN_REVIEW",
  "PENDING_APPROVAL",
  "RESOLVED",
  "DISMISSED",
] as const;
export type ExceptionStatus = (typeof EXCEPTION_STATUSES)[number];

export const EXCEPTION_STATUS_LABELS: Record<ExceptionStatus, string> = {
  OPEN: "Open",
  IN_REVIEW: "In review",
  PENDING_APPROVAL: "Pending approval",
  RESOLVED: "Resolved",
  DISMISSED: "Dismissed",
};

export const OPEN_EXCEPTION_STATUSES: ExceptionStatus[] = ["OPEN", "IN_REVIEW", "PENDING_APPROVAL"];

export const RESOLUTION_CODES = [
  "AUTO_REVERSAL_CONFIRMED",
  "MANUAL_REVERSAL_ISSUED",
  "MERCHANT_STATUS_SYNCED",
  "LATE_RECORD_RECEIVED",
  "DUPLICATE_REVERSED",
  "REFUND_CREDITED",
  "SETTLEMENT_ADJUSTED",
  "DATA_CORRECTED_AT_SOURCE",
  "CHARGEBACK_RAISED",
  "OTHER",
] as const;
export type ResolutionCode = (typeof RESOLUTION_CODES)[number];

export const RESOLUTION_LABELS: Record<ResolutionCode, string> = {
  AUTO_REVERSAL_CONFIRMED: "Auto-reversal confirmed",
  MANUAL_REVERSAL_ISSUED: "Manual reversal issued",
  MERCHANT_STATUS_SYNCED: "Merchant status synced",
  LATE_RECORD_RECEIVED: "Late record received",
  DUPLICATE_REVERSED: "Duplicate debit reversed",
  REFUND_CREDITED: "Refund credited to customer",
  SETTLEMENT_ADJUSTED: "Settlement adjusted",
  DATA_CORRECTED_AT_SOURCE: "Data corrected at source",
  CHARGEBACK_RAISED: "Chargeback / dispute raised",
  OTHER: "Other (explain in note)",
};

export const USER_ROLES = ["admin", "supervisor", "analyst", "viewer"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Administrator",
  supervisor: "Supervisor",
  analyst: "Analyst",
  viewer: "Viewer",
};

/** A normalised record from any participant, as the reconciliation engine sees it. */
export interface NormalizedRecord {
  id?: number;
  source: SourceSystem;
  txnRef: string;
  parentRef: string | null;
  recordType: RecordType;
  method: PaymentMethod;
  amountPaise: number;
  status: RecordStatus;
  customerId: string | null;
  merchantId: string | null;
  issuingBank: string | null;
  acquiringBank: string | null;
  eventAt: Date;
}
