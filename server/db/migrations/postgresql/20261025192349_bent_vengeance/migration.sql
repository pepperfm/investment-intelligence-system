CREATE TABLE "bar_quality_audits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"instrument_id" uuid NOT NULL,
	"source" text NOT NULL,
	"policy_id" text NOT NULL,
	"policy_version" text NOT NULL,
	"source_revision" text NOT NULL,
	"board" text NOT NULL,
	"market" text NOT NULL,
	"from_date" text NOT NULL,
	"to_date" text NOT NULL,
	"status" text NOT NULL,
	"payload" jsonb NOT NULL,
	"observed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "normalized_market_bars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"audit_id" uuid NOT NULL,
	"instrument_id" uuid NOT NULL,
	"source" text NOT NULL,
	"policy_id" text NOT NULL,
	"source_revision" text NOT NULL,
	"session_date" text NOT NULL,
	"status" text NOT NULL,
	"candle" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raw_market_bars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"instrument_id" uuid NOT NULL,
	"source" text NOT NULL,
	"endpoint" text NOT NULL,
	"board" text NOT NULL,
	"interval" text NOT NULL,
	"payload" jsonb NOT NULL,
	"response_hash" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analysis_runs" ADD COLUMN "research_selection" jsonb;--> statement-breakpoint
CREATE INDEX "bar_audit_instrument_idx" ON "bar_quality_audits" ("instrument_id","source","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "normalized_audit_date_idx" ON "normalized_market_bars" ("audit_id","session_date");--> statement-breakpoint
CREATE INDEX "normalized_instrument_idx" ON "normalized_market_bars" ("instrument_id","policy_id","session_date");--> statement-breakpoint
CREATE INDEX "raw_market_instrument_idx" ON "raw_market_bars" ("instrument_id","observed_at");--> statement-breakpoint
ALTER TABLE "bar_quality_audits" ADD CONSTRAINT "bar_quality_audits_instrument_id_instruments_id_fkey" FOREIGN KEY ("instrument_id") REFERENCES "instruments"("id");--> statement-breakpoint
ALTER TABLE "normalized_market_bars" ADD CONSTRAINT "normalized_market_bars_audit_id_bar_quality_audits_id_fkey" FOREIGN KEY ("audit_id") REFERENCES "bar_quality_audits"("id");--> statement-breakpoint
ALTER TABLE "normalized_market_bars" ADD CONSTRAINT "normalized_market_bars_instrument_id_instruments_id_fkey" FOREIGN KEY ("instrument_id") REFERENCES "instruments"("id");--> statement-breakpoint
ALTER TABLE "raw_market_bars" ADD CONSTRAINT "raw_market_bars_instrument_id_instruments_id_fkey" FOREIGN KEY ("instrument_id") REFERENCES "instruments"("id");