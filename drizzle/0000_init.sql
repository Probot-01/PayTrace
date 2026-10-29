CREATE TYPE "public"."exception_category" AS ENUM('SUCCESS_MERCHANT_NOT_UPDATED', 'FAILED_BUT_DEBITED', 'DUPLICATE', 'MISSING', 'AMOUNT_MISMATCH', 'STATUS_MISMATCH', 'DELAYED', 'REFUND_MISMATCH', 'SETTLEMENT_MISMATCH');--> statement-breakpoint
CREATE TYPE "public"."exception_status" AS ENUM('OPEN', 'IN_REVIEW', 'PENDING_APPROVAL', 'RESOLVED', 'DISMISSED');--> statement-breakpoint
CREATE TYPE "public"."file_origin" AS ENUM('UPLOAD', 'SIMULATOR');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('UPI', 'DEBIT_CARD', 'CREDIT_CARD', 'NEFT', 'RTGS');--> statement-breakpoint
CREATE TYPE "public"."record_status" AS ENUM('SUCCESS', 'FAILED', 'PENDING', 'REVERSED');--> statement-breakpoint
CREATE TYPE "public"."record_type" AS ENUM('PAYMENT', 'REFUND', 'REVERSAL');--> statement-breakpoint
CREATE TYPE "public"."resolution_code" AS ENUM('AUTO_REVERSAL_CONFIRMED', 'MANUAL_REVERSAL_ISSUED', 'MERCHANT_STATUS_SYNCED', 'LATE_RECORD_RECEIVED', 'DUPLICATE_REVERSED', 'REFUND_CREDITED', 'SETTLEMENT_ADJUSTED', 'DATA_CORRECTED_AT_SOURCE', 'CHARGEBACK_RAISED', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."severity" AS ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');--> statement-breakpoint
CREATE TYPE "public"."source_system" AS ENUM('SWITCH', 'ISSUER', 'ACQUIRER', 'MERCHANT', 'SETTLEMENT');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'supervisor', 'analyst', 'viewer');--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor_id" uuid,
	"actor_email" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exception_activity" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"exception_id" uuid NOT NULL,
	"actor_id" uuid,
	"kind" text NOT NULL,
	"body" text NOT NULL,
	"from_status" "exception_status",
	"to_status" "exception_status",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"txn_ref" text NOT NULL,
	"category" "exception_category" NOT NULL,
	"severity" "severity" NOT NULL,
	"status" "exception_status" DEFAULT 'OPEN' NOT NULL,
	"method" "payment_method" NOT NULL,
	"amount_paise" bigint NOT NULL,
	"affected_paise" bigint NOT NULL,
	"failure_point" "source_system",
	"suspected_cause" text NOT NULL,
	"recommended_action" text NOT NULL,
	"requires_manual" boolean NOT NULL,
	"evidence" jsonb NOT NULL,
	"txn_at" timestamp with time zone NOT NULL,
	"tat_due_at" timestamp with time zone NOT NULL,
	"tat_basis" text NOT NULL,
	"tat_description" text NOT NULL,
	"compensation" jsonb NOT NULL,
	"assignee_id" uuid,
	"resolution_code" "resolution_code",
	"resolution_note" text,
	"proposed_by" uuid,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exceptions_affected_nonneg" CHECK ("exceptions"."affected_paise" >= 0)
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "job_status" DEFAULT 'QUEUED' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "password_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"window_start" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recon_run_files" (
	"run_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	CONSTRAINT "recon_run_files_run_id_file_id_pk" PRIMARY KEY("run_id","file_id")
);
--> statement-breakpoint
CREATE TABLE "recon_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_date" date NOT NULL,
	"status" "job_status" DEFAULT 'QUEUED' NOT NULL,
	"stats" jsonb,
	"config_snapshot" jsonb,
	"total_transactions" integer DEFAULT 0 NOT NULL,
	"matched_transactions" integer DEFAULT 0 NOT NULL,
	"exception_count" integer DEFAULT 0 NOT NULL,
	"affected_value_paise" bigint DEFAULT 0 NOT NULL,
	"error" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "recon_transactions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"txn_ref" text NOT NULL,
	"method" "payment_method" NOT NULL,
	"amount_paise" bigint NOT NULL,
	"outcome" text NOT NULL,
	"matched" boolean NOT NULL,
	"is_refund" boolean DEFAULT false NOT NULL,
	"sources_present" text[] NOT NULL,
	"exception_count" integer DEFAULT 0 NOT NULL,
	"txn_at" timestamp with time zone NOT NULL,
	"customer_id" text,
	"merchant_id" text
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" text,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "sim_transactions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"simulation_id" uuid NOT NULL,
	"txn_ref" text NOT NULL,
	"parent_ref" text,
	"kind" text NOT NULL,
	"customer_id" text NOT NULL,
	"merchant_id" text NOT NULL,
	"amount_paise" bigint NOT NULL,
	"method" "payment_method" NOT NULL,
	"initiated_at" timestamp with time zone NOT NULL,
	"issuing_bank" text NOT NULL,
	"acquiring_bank" text NOT NULL,
	"switch_status" "record_status" NOT NULL,
	"bank_status" "record_status" NOT NULL,
	"merchant_status" text NOT NULL,
	"settlement_status" text NOT NULL,
	"refund_status" text NOT NULL,
	"injected_fault" text NOT NULL,
	"failure_stage" text,
	"timeline" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "simulations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"business_date" date NOT NULL,
	"config" jsonb NOT NULL,
	"status" "job_status" DEFAULT 'QUEUED' NOT NULL,
	"transaction_count" integer DEFAULT 0 NOT NULL,
	"fault_counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "source_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" "source_system" NOT NULL,
	"business_date" date NOT NULL,
	"origin" "file_origin" NOT NULL,
	"simulation_id" uuid,
	"filename" text NOT NULL,
	"sha256" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"row_count" integer NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_records" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"file_id" uuid NOT NULL,
	"source" "source_system" NOT NULL,
	"line_no" integer NOT NULL,
	"txn_ref" text NOT NULL,
	"parent_ref" text,
	"record_type" "record_type" NOT NULL,
	"method" "payment_method" NOT NULL,
	"amount_paise" bigint NOT NULL,
	"status" "record_status" NOT NULL,
	"raw_status" text NOT NULL,
	"customer_id" text,
	"merchant_id" text,
	"issuing_bank" text,
	"acquiring_bank" text,
	"event_at" timestamp with time zone NOT NULL,
	CONSTRAINT "source_records_amount_positive" CHECK ("source_records"."amount_paise" > 0)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" "user_role" DEFAULT 'viewer' NOT NULL,
	"password_hash" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"password_changed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_shape" CHECK ("users"."email" ~ '^[^@\s]+@[^@\s]+$')
);
--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exception_activity" ADD CONSTRAINT "exception_activity_exception_id_exceptions_id_fk" FOREIGN KEY ("exception_id") REFERENCES "public"."exceptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exception_activity" ADD CONSTRAINT "exception_activity_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_run_id_recon_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."recon_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_proposed_by_users_id_fk" FOREIGN KEY ("proposed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_tokens" ADD CONSTRAINT "password_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recon_run_files" ADD CONSTRAINT "recon_run_files_run_id_recon_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."recon_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recon_run_files" ADD CONSTRAINT "recon_run_files_file_id_source_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."source_files"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recon_runs" ADD CONSTRAINT "recon_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recon_transactions" ADD CONSTRAINT "recon_transactions_run_id_recon_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."recon_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sim_transactions" ADD CONSTRAINT "sim_transactions_simulation_id_simulations_id_fk" FOREIGN KEY ("simulation_id") REFERENCES "public"."simulations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simulations" ADD CONSTRAINT "simulations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_files" ADD CONSTRAINT "source_files_simulation_id_simulations_id_fk" FOREIGN KEY ("simulation_id") REFERENCES "public"."simulations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_files" ADD CONSTRAINT "source_files_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_records" ADD CONSTRAINT "source_records_file_id_source_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."source_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_created_idx" ON "audit_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_actor_idx" ON "audit_events" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "exception_activity_exc_idx" ON "exception_activity" USING btree ("exception_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "exceptions_run_ref_cat_idx" ON "exceptions" USING btree ("run_id","txn_ref","category");--> statement-breakpoint
CREATE INDEX "exceptions_status_idx" ON "exceptions" USING btree ("status","severity");--> statement-breakpoint
CREATE INDEX "exceptions_category_idx" ON "exceptions" USING btree ("category");--> statement-breakpoint
CREATE INDEX "exceptions_ref_idx" ON "exceptions" USING btree ("txn_ref");--> statement-breakpoint
CREATE INDEX "exceptions_assignee_idx" ON "exceptions" USING btree ("assignee_id");--> statement-breakpoint
CREATE INDEX "exceptions_tat_idx" ON "exceptions" USING btree ("tat_due_at");--> statement-breakpoint
CREATE INDEX "jobs_ready_idx" ON "jobs" USING btree ("status","run_after");--> statement-breakpoint
CREATE INDEX "password_tokens_user_idx" ON "password_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "recon_run_files_file_idx" ON "recon_run_files" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "recon_runs_created_idx" ON "recon_runs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "recon_runs_date_idx" ON "recon_runs" USING btree ("business_date");--> statement-breakpoint
CREATE UNIQUE INDEX "recon_txn_run_ref_idx" ON "recon_transactions" USING btree ("run_id","txn_ref");--> statement-breakpoint
CREATE INDEX "recon_txn_ref_idx" ON "recon_transactions" USING btree ("txn_ref");--> statement-breakpoint
CREATE INDEX "recon_txn_run_outcome_idx" ON "recon_transactions" USING btree ("run_id","outcome");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sim_txn_ref_idx" ON "sim_transactions" USING btree ("simulation_id","txn_ref");--> statement-breakpoint
CREATE INDEX "sim_txn_ref_lookup_idx" ON "sim_transactions" USING btree ("txn_ref");--> statement-breakpoint
CREATE INDEX "simulations_created_idx" ON "simulations" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "source_files_dedupe_idx" ON "source_files" USING btree ("source","sha256");--> statement-breakpoint
CREATE INDEX "source_files_date_idx" ON "source_files" USING btree ("business_date","source");--> statement-breakpoint
CREATE INDEX "source_records_file_idx" ON "source_records" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "source_records_ref_idx" ON "source_records" USING btree ("txn_ref");--> statement-breakpoint
CREATE INDEX "source_records_parent_idx" ON "source_records" USING btree ("parent_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_idx" ON "users" USING btree (lower("email"));