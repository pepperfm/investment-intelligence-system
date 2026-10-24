CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TABLE "auth_account" (
	"id" text PRIMARY KEY,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"currency" text DEFAULT 'RUB' NOT NULL,
	"initial_cash" double precision NOT NULL,
	"cash" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analysis_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"strategies" jsonb NOT NULL,
	"instrument_ids" jsonb NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"provider" text NOT NULL,
	"critic_provider" text NOT NULL,
	"rules_versions" jsonb DEFAULT '{}' NOT NULL,
	"log" jsonb DEFAULT '[]' NOT NULL,
	"summary" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "candles" (
	"instrument_id" uuid,
	"timeframe" text,
	"ts" timestamp with time zone,
	"open" double precision NOT NULL,
	"high" double precision NOT NULL,
	"low" double precision NOT NULL,
	"close" double precision NOT NULL,
	"volume" double precision NOT NULL,
	CONSTRAINT "candles_pkey" PRIMARY KEY("instrument_id","timeframe","ts")
);
--> statement-breakpoint
CREATE TABLE "document_embeddings" (
	"document_id" uuid PRIMARY KEY,
	"model" text NOT NULL,
	"embedding" vector(256) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"kind" text NOT NULL,
	"ref_id" text NOT NULL,
	"instrument_id" uuid,
	"strategy_id" text,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"available_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"order_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"instrument_id" uuid NOT NULL,
	"side" text NOT NULL,
	"price" double precision NOT NULL,
	"quantity" integer NOT NULL,
	"commission" double precision NOT NULL,
	"executed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hypotheses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"run_id" uuid NOT NULL,
	"instrument_id" uuid NOT NULL,
	"strategy_id" text NOT NULL,
	"strategy_version_id" uuid NOT NULL,
	"snapshot_id" uuid,
	"direction" text NOT NULL,
	"horizon_days" integer NOT NULL,
	"thesis" text NOT NULL,
	"supporting_evidence" jsonb NOT NULL,
	"counter_evidence" jsonb NOT NULL,
	"assumptions" jsonb NOT NULL,
	"invalidation_conditions" jsonb NOT NULL,
	"entry_scenario" jsonb NOT NULL,
	"exit_scenario" jsonb NOT NULL,
	"risk_notes" jsonb NOT NULL,
	"alternatives" jsonb DEFAULT '[]' NOT NULL,
	"sources" jsonb NOT NULL,
	"metrics" jsonb NOT NULL,
	"validation" jsonb NOT NULL,
	"confidence" double precision NOT NULL,
	"evidence_timestamp" timestamp with time zone NOT NULL,
	"check_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"critic_verdict" text,
	"critic_findings" jsonb DEFAULT '[]' NOT NULL,
	"analyst_provider" text NOT NULL,
	"analyst_version" text NOT NULL,
	"user_comment" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hypothesis_evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"hypothesis_id" uuid NOT NULL,
	"is_counterfactual" boolean NOT NULL,
	"entered" boolean NOT NULL,
	"entry_at" timestamp with time zone,
	"exit_at" timestamp with time zone,
	"entry_price" double precision,
	"exit_price" double precision,
	"exit_reason" text NOT NULL,
	"gross_return" double precision NOT NULL,
	"net_return" double precision NOT NULL,
	"benchmark_return" double precision NOT NULL,
	"excess_return" double precision NOT NULL,
	"max_drawdown" double precision NOT NULL,
	"max_favorable" double precision NOT NULL,
	"outcome" text NOT NULL,
	"costs" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hypothesis_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"hypothesis_id" uuid NOT NULL,
	"type" text NOT NULL,
	"from_status" text,
	"to_status" text,
	"actor" text NOT NULL,
	"comment" text,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hypothesis_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"hypothesis_id" uuid NOT NULL,
	"role" text NOT NULL,
	"provider" text NOT NULL,
	"verdict" text NOT NULL,
	"summary" text NOT NULL,
	"findings" jsonb NOT NULL,
	"missing_checks" jsonb NOT NULL,
	"raw" jsonb,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instruments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"symbol" text NOT NULL UNIQUE,
	"ticker" text NOT NULL,
	"board" text NOT NULL,
	"name" text NOT NULL,
	"sector" text DEFAULT 'other' NOT NULL,
	"kind" text DEFAULT 'equity' NOT NULL,
	"lot_size" integer DEFAULT 1 NOT NULL,
	"currency" text DEFAULT 'RUB' NOT NULL,
	"isin" text,
	"provider" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issuer_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"external_id" text NOT NULL UNIQUE,
	"instrument_id" uuid NOT NULL,
	"period" text NOT NULL,
	"report_type" text NOT NULL,
	"metrics" jsonb NOT NULL,
	"source" text NOT NULL,
	"url" text,
	"published_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"external_id" text NOT NULL UNIQUE,
	"instrument_id" uuid,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"url" text,
	"source" text NOT NULL,
	"sentiment" double precision,
	"published_at" timestamp with time zone NOT NULL,
	"retrieved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"account_id" uuid NOT NULL,
	"hypothesis_id" uuid,
	"instrument_id" uuid NOT NULL,
	"side" text NOT NULL,
	"type" text NOT NULL,
	"quantity" integer NOT NULL,
	"limit_price" double precision,
	"status" text NOT NULL,
	"idempotency_key" text NOT NULL UNIQUE,
	"risk_check" jsonb NOT NULL,
	"estimated_commission" double precision NOT NULL,
	"reject_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "portfolio_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"account_id" uuid NOT NULL,
	"taken_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cash" double precision NOT NULL,
	"equity" double precision NOT NULL,
	"positions" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_session" (
	"id" text PRIMARY KEY,
	"token" text NOT NULL UNIQUE,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"run_id" uuid NOT NULL,
	"instrument_id" uuid,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"sha256" text NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "strategies" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"description" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "strategy_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"strategy_id" text NOT NULL,
	"version" integer NOT NULL,
	"rules" jsonb NOT NULL,
	"status" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"proposed_by" text DEFAULT 'system' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "auth_user" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"email" text NOT NULL UNIQUE,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_verification" (
	"id" text PRIMARY KEY,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "auth_account_user_idx" ON "auth_account" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_account_provider_idx" ON "auth_account" ("provider_id","account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_external_idx" ON "accounts" ("provider","external_id");--> statement-breakpoint
CREATE INDEX "analysis_runs_created_idx" ON "analysis_runs" ("created_at");--> statement-breakpoint
CREATE INDEX "document_embeddings_hnsw_idx" ON "document_embeddings" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "documents_ref_idx" ON "documents" ("kind","ref_id");--> statement-breakpoint
CREATE INDEX "documents_available_idx" ON "documents" ("available_at");--> statement-breakpoint
CREATE INDEX "executions_account_idx" ON "executions" ("account_id","executed_at");--> statement-breakpoint
CREATE INDEX "hypotheses_status_idx" ON "hypotheses" ("status");--> statement-breakpoint
CREATE INDEX "hypotheses_instrument_idx" ON "hypotheses" ("instrument_id");--> statement-breakpoint
CREATE INDEX "hypotheses_run_idx" ON "hypotheses" ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "hypothesis_evaluations_hypothesis_idx" ON "hypothesis_evaluations" ("hypothesis_id");--> statement-breakpoint
CREATE INDEX "hypothesis_events_hypothesis_idx" ON "hypothesis_events" ("hypothesis_id","created_at");--> statement-breakpoint
CREATE INDEX "hypothesis_reviews_hypothesis_idx" ON "hypothesis_reviews" ("hypothesis_id");--> statement-breakpoint
CREATE INDEX "issuer_reports_instrument_idx" ON "issuer_reports" ("instrument_id","published_at");--> statement-breakpoint
CREATE INDEX "market_events_instrument_idx" ON "market_events" ("instrument_id","published_at");--> statement-breakpoint
CREATE INDEX "orders_account_idx" ON "orders" ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "portfolio_snapshots_account_idx" ON "portfolio_snapshots" ("account_id","taken_at");--> statement-breakpoint
CREATE INDEX "auth_session_user_idx" ON "auth_session" ("user_id");--> statement-breakpoint
CREATE INDEX "source_snapshots_run_idx" ON "source_snapshots" ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "strategy_versions_version_idx" ON "strategy_versions" ("strategy_id","version");--> statement-breakpoint
CREATE INDEX "auth_verification_identifier_idx" ON "auth_verification" ("identifier");--> statement-breakpoint
ALTER TABLE "auth_account" ADD CONSTRAINT "auth_account_user_id_auth_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "candles" ADD CONSTRAINT "candles_instrument_id_instruments_id_fkey" FOREIGN KEY ("instrument_id") REFERENCES "instruments"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "document_embeddings" ADD CONSTRAINT "document_embeddings_document_id_documents_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_instrument_id_instruments_id_fkey" FOREIGN KEY ("instrument_id") REFERENCES "instruments"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_order_id_orders_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_account_id_accounts_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id");--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_instrument_id_instruments_id_fkey" FOREIGN KEY ("instrument_id") REFERENCES "instruments"("id");--> statement-breakpoint
ALTER TABLE "hypotheses" ADD CONSTRAINT "hypotheses_run_id_analysis_runs_id_fkey" FOREIGN KEY ("run_id") REFERENCES "analysis_runs"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "hypotheses" ADD CONSTRAINT "hypotheses_instrument_id_instruments_id_fkey" FOREIGN KEY ("instrument_id") REFERENCES "instruments"("id");--> statement-breakpoint
ALTER TABLE "hypotheses" ADD CONSTRAINT "hypotheses_strategy_id_strategies_id_fkey" FOREIGN KEY ("strategy_id") REFERENCES "strategies"("id");--> statement-breakpoint
ALTER TABLE "hypotheses" ADD CONSTRAINT "hypotheses_strategy_version_id_strategy_versions_id_fkey" FOREIGN KEY ("strategy_version_id") REFERENCES "strategy_versions"("id");--> statement-breakpoint
ALTER TABLE "hypotheses" ADD CONSTRAINT "hypotheses_snapshot_id_source_snapshots_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "source_snapshots"("id");--> statement-breakpoint
ALTER TABLE "hypothesis_evaluations" ADD CONSTRAINT "hypothesis_evaluations_hypothesis_id_hypotheses_id_fkey" FOREIGN KEY ("hypothesis_id") REFERENCES "hypotheses"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "hypothesis_events" ADD CONSTRAINT "hypothesis_events_hypothesis_id_hypotheses_id_fkey" FOREIGN KEY ("hypothesis_id") REFERENCES "hypotheses"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "hypothesis_reviews" ADD CONSTRAINT "hypothesis_reviews_hypothesis_id_hypotheses_id_fkey" FOREIGN KEY ("hypothesis_id") REFERENCES "hypotheses"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "issuer_reports" ADD CONSTRAINT "issuer_reports_instrument_id_instruments_id_fkey" FOREIGN KEY ("instrument_id") REFERENCES "instruments"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "market_events" ADD CONSTRAINT "market_events_instrument_id_instruments_id_fkey" FOREIGN KEY ("instrument_id") REFERENCES "instruments"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_account_id_accounts_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_hypothesis_id_hypotheses_id_fkey" FOREIGN KEY ("hypothesis_id") REFERENCES "hypotheses"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_instrument_id_instruments_id_fkey" FOREIGN KEY ("instrument_id") REFERENCES "instruments"("id");--> statement-breakpoint
ALTER TABLE "portfolio_snapshots" ADD CONSTRAINT "portfolio_snapshots_account_id_accounts_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_user_id_auth_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "source_snapshots" ADD CONSTRAINT "source_snapshots_run_id_analysis_runs_id_fkey" FOREIGN KEY ("run_id") REFERENCES "analysis_runs"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "source_snapshots" ADD CONSTRAINT "source_snapshots_instrument_id_instruments_id_fkey" FOREIGN KEY ("instrument_id") REFERENCES "instruments"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "strategy_versions" ADD CONSTRAINT "strategy_versions_strategy_id_strategies_id_fkey" FOREIGN KEY ("strategy_id") REFERENCES "strategies"("id");