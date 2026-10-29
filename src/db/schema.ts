import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  EXCEPTION_CATEGORIES,
  EXCEPTION_STATUSES,
  PAYMENT_METHODS,
  RECORD_STATUSES,
  RECORD_TYPES,
  RESOLUTION_CODES,
  SEVERITIES,
  SOURCE_SYSTEMS,
  USER_ROLES,
} from "@/domain/types";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const money = (name: string) => bigint(name, { mode: "number" });

export const userRole = pgEnum("user_role", USER_ROLES);
export const paymentMethod = pgEnum("payment_method", PAYMENT_METHODS);
export const sourceSystem = pgEnum("source_system", SOURCE_SYSTEMS);
export const recordStatus = pgEnum("record_status", RECORD_STATUSES);
export const recordType = pgEnum("record_type", RECORD_TYPES);
export const exceptionCategory = pgEnum("exception_category", EXCEPTION_CATEGORIES);
export const exceptionStatus = pgEnum("exception_status", EXCEPTION_STATUSES);
export const severity = pgEnum("severity", SEVERITIES);
export const resolutionCode = pgEnum("resolution_code", RESOLUTION_CODES);
export const fileOrigin = pgEnum("file_origin", ["UPLOAD", "SIMULATOR"]);
export const jobStatus = pgEnum("job_status", ["QUEUED", "RUNNING", "COMPLETED", "FAILED"]);

// ---- Identity & access ----------------------------------------------------------------------

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    role: userRole("role").notNull().default("viewer"),
    passwordHash: text("password_hash"),
    isActive: boolean("is_active").notNull().default(true),
    failedLoginCount: integer("failed_login_count").notNull().default(0),
    lockedUntil: ts("locked_until"),
    lastLoginAt: ts("last_login_at"),
    passwordChangedAt: ts("password_changed_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("users_email_lower_idx").on(sql`lower(${t.email})`),
    check("users_email_shape", sql`${t.email} ~ '^[^@\\s]+@[^@\\s]+$'`),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    /** SHA-256 of the session token; the token itself only ever lives in the user's cookie. */
    id: text("id").primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    expiresAt: ts("expires_at").notNull(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
    createdAt: ts("created_at").notNull().defaultNow(),
    ip: text("ip"),
    userAgent: text("user_agent"),
  },
  (t) => [index("sessions_user_idx").on(t.userId), index("sessions_expires_idx").on(t.expiresAt)],
);

export const passwordTokens = pgTable(
  "password_tokens",
  {
    /** SHA-256 of the one-time token. */
    id: text("id").primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    purpose: text("purpose", { enum: ["INVITE", "RESET"] }).notNull(),
    expiresAt: ts("expires_at").notNull(),
    usedAt: ts("used_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("password_tokens_user_idx").on(t.userId)],
);

export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  windowStart: ts("window_start").notNull(),
});

export const auditEvents = pgTable(
  "audit_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    actorEmail: text("actor_email"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ip: text("ip"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("audit_created_idx").on(t.createdAt),
    index("audit_entity_idx").on(t.entityType, t.entityId),
    index("audit_actor_idx").on(t.actorId),
  ],
);

export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

// ---- Simulation -----------------------------------------------------------------------------

export const simulations = pgTable(
  "simulations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    businessDate: date("business_date", { mode: "string" }).notNull(),
    config: jsonb("config").notNull(),
    status: jobStatus("status").notNull().default("QUEUED"),
    transactionCount: integer("transaction_count").notNull().default(0),
    faultCounts: jsonb("fault_counts").$type<Record<string, number>>().notNull().default({}),
    error: text("error"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: ts("created_at").notNull().defaultNow(),
    completedAt: ts("completed_at"),
  },
  (t) => [index("simulations_created_idx").on(t.createdAt)],
);

export const simTransactions = pgTable(
  "sim_transactions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    simulationId: uuid("simulation_id").notNull().references(() => simulations.id, { onDelete: "cascade" }),
    txnRef: text("txn_ref").notNull(),
    parentRef: text("parent_ref"),
    kind: text("kind", { enum: ["PAYMENT", "REFUND"] }).notNull(),
    customerId: text("customer_id").notNull(),
    merchantId: text("merchant_id").notNull(),
    amountPaise: money("amount_paise").notNull(),
    method: paymentMethod("method").notNull(),
    initiatedAt: ts("initiated_at").notNull(),
    issuingBank: text("issuing_bank").notNull(),
    acquiringBank: text("acquiring_bank").notNull(),
    switchStatus: recordStatus("switch_status").notNull(),
    bankStatus: recordStatus("bank_status").notNull(),
    merchantStatus: text("merchant_status").notNull(),
    settlementStatus: text("settlement_status").notNull(),
    refundStatus: text("refund_status").notNull(),
    injectedFault: text("injected_fault").notNull(),
    failureStage: text("failure_stage"),
    timeline: jsonb("timeline").notNull(),
  },
  (t) => [
    uniqueIndex("sim_txn_ref_idx").on(t.simulationId, t.txnRef),
    index("sim_txn_ref_lookup_idx").on(t.txnRef),
  ],
);

// ---- Participant files ------------------------------------------------------------------------

export const sourceFiles = pgTable(
  "source_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: sourceSystem("source").notNull(),
    businessDate: date("business_date", { mode: "string" }).notNull(),
    origin: fileOrigin("origin").notNull(),
    simulationId: uuid("simulation_id").references(() => simulations.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    sha256: text("sha256").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    rowCount: integer("row_count").notNull(),
    uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("source_files_dedupe_idx").on(t.source, t.sha256),
    index("source_files_date_idx").on(t.businessDate, t.source),
  ],
);

export const sourceRecords = pgTable(
  "source_records",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    fileId: uuid("file_id").notNull().references(() => sourceFiles.id, { onDelete: "cascade" }),
    source: sourceSystem("source").notNull(),
    lineNo: integer("line_no").notNull(),
    txnRef: text("txn_ref").notNull(),
    parentRef: text("parent_ref"),
    recordType: recordType("record_type").notNull(),
    method: paymentMethod("method").notNull(),
    amountPaise: money("amount_paise").notNull(),
    status: recordStatus("status").notNull(),
    rawStatus: text("raw_status").notNull(),
    customerId: text("customer_id"),
    merchantId: text("merchant_id"),
    issuingBank: text("issuing_bank"),
    acquiringBank: text("acquiring_bank"),
    eventAt: ts("event_at").notNull(),
  },
  (t) => [
    index("source_records_file_idx").on(t.fileId),
    index("source_records_ref_idx").on(t.txnRef),
    index("source_records_parent_idx").on(t.parentRef),
    check("source_records_amount_positive", sql`${t.amountPaise} > 0`),
  ],
);

// ---- Reconciliation -----------------------------------------------------------------------------

export const reconRuns = pgTable(
  "recon_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessDate: date("business_date", { mode: "string" }).notNull(),
    status: jobStatus("status").notNull().default("QUEUED"),
    stats: jsonb("stats"),
    configSnapshot: jsonb("config_snapshot"),
    totalTransactions: integer("total_transactions").notNull().default(0),
    matchedTransactions: integer("matched_transactions").notNull().default(0),
    exceptionCount: integer("exception_count").notNull().default(0),
    affectedValuePaise: money("affected_value_paise").notNull().default(0),
    error: text("error"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: ts("created_at").notNull().defaultNow(),
    startedAt: ts("started_at"),
    finishedAt: ts("finished_at"),
  },
  (t) => [index("recon_runs_created_idx").on(t.createdAt), index("recon_runs_date_idx").on(t.businessDate)],
);

export const reconRunFiles = pgTable(
  "recon_run_files",
  {
    runId: uuid("run_id").notNull().references(() => reconRuns.id, { onDelete: "cascade" }),
    fileId: uuid("file_id").notNull().references(() => sourceFiles.id, { onDelete: "restrict" }),
  },
  (t) => [primaryKey({ columns: [t.runId, t.fileId] }), index("recon_run_files_file_idx").on(t.fileId)],
);

export const reconTransactions = pgTable(
  "recon_transactions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    runId: uuid("run_id").notNull().references(() => reconRuns.id, { onDelete: "cascade" }),
    txnRef: text("txn_ref").notNull(),
    method: paymentMethod("method").notNull(),
    amountPaise: money("amount_paise").notNull(),
    outcome: text("outcome", { enum: ["SUCCESS", "FAILED", "PENDING"] }).notNull(),
    matched: boolean("matched").notNull(),
    isRefund: boolean("is_refund").notNull().default(false),
    sourcesPresent: text("sources_present").array().notNull(),
    exceptionCount: integer("exception_count").notNull().default(0),
    txnAt: ts("txn_at").notNull(),
    customerId: text("customer_id"),
    merchantId: text("merchant_id"),
  },
  (t) => [
    uniqueIndex("recon_txn_run_ref_idx").on(t.runId, t.txnRef),
    index("recon_txn_ref_idx").on(t.txnRef),
    index("recon_txn_run_outcome_idx").on(t.runId, t.outcome),
  ],
);

export const exceptions = pgTable(
  "exceptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id").notNull().references(() => reconRuns.id, { onDelete: "cascade" }),
    txnRef: text("txn_ref").notNull(),
    category: exceptionCategory("category").notNull(),
    severity: severity("severity").notNull(),
    status: exceptionStatus("status").notNull().default("OPEN"),
    method: paymentMethod("method").notNull(),
    amountPaise: money("amount_paise").notNull(),
    affectedPaise: money("affected_paise").notNull(),
    failurePoint: sourceSystem("failure_point"),
    suspectedCause: text("suspected_cause").notNull(),
    recommendedAction: text("recommended_action").notNull(),
    requiresManual: boolean("requires_manual").notNull(),
    evidence: jsonb("evidence").notNull(),
    txnAt: ts("txn_at").notNull(),
    tatDueAt: ts("tat_due_at").notNull(),
    tatBasis: text("tat_basis", { enum: ["RBI", "INTERNAL"] }).notNull(),
    tatDescription: text("tat_description").notNull(),
    compensation: jsonb("compensation").notNull(),
    assigneeId: uuid("assignee_id").references(() => users.id, { onDelete: "set null" }),
    resolutionCode: resolutionCode("resolution_code"),
    resolutionNote: text("resolution_note"),
    proposedBy: uuid("proposed_by").references(() => users.id, { onDelete: "set null" }),
    resolvedBy: uuid("resolved_by").references(() => users.id, { onDelete: "set null" }),
    resolvedAt: ts("resolved_at"),
    version: integer("version").notNull().default(1),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("exceptions_run_ref_cat_idx").on(t.runId, t.txnRef, t.category),
    index("exceptions_status_idx").on(t.status, t.severity),
    index("exceptions_category_idx").on(t.category),
    index("exceptions_ref_idx").on(t.txnRef),
    index("exceptions_assignee_idx").on(t.assigneeId),
    index("exceptions_tat_idx").on(t.tatDueAt),
    check("exceptions_affected_nonneg", sql`${t.affectedPaise} >= 0`),
  ],
);

export const exceptionActivity = pgTable(
  "exception_activity",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    exceptionId: uuid("exception_id").notNull().references(() => exceptions.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    kind: text("kind", { enum: ["COMMENT", "STATUS", "ASSIGNMENT"] }).notNull(),
    body: text("body").notNull(),
    fromStatus: exceptionStatus("from_status"),
    toStatus: exceptionStatus("to_status"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("exception_activity_exc_idx").on(t.exceptionId, t.createdAt)],
);

// ---- Background jobs ------------------------------------------------------------------------------

export const jobs = pgTable(
  "jobs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    type: text("type", { enum: ["SIMULATE", "RECONCILE"] }).notNull(),
    payload: jsonb("payload").$type<{ id: string }>().notNull(),
    status: jobStatus("status").notNull().default("QUEUED"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    runAfter: ts("run_after").notNull().defaultNow(),
    lockedAt: ts("locked_at"),
    lockedBy: text("locked_by"),
    lastError: text("last_error"),
    createdAt: ts("created_at").notNull().defaultNow(),
    finishedAt: ts("finished_at"),
  },
  (t) => [index("jobs_ready_idx").on(t.status, t.runAfter)],
);
