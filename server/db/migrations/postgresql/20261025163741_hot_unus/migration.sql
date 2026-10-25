CREATE TABLE "hypothesis_evaluation_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"hypothesis_id" uuid NOT NULL,
	"result" jsonb NOT NULL,
	"evaluation_version" text NOT NULL,
	"calendar_version" text NOT NULL,
	"cost_model_hash" text,
	"source_snapshot_hash" text,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analysis_runs" ADD COLUMN "pinned_strategies" jsonb;--> statement-breakpoint
ALTER TABLE "analysis_runs" ADD COLUMN "execution_costs" jsonb;--> statement-breakpoint
ALTER TABLE "candles" ADD COLUMN "metadata" jsonb;--> statement-breakpoint
ALTER TABLE "hypotheses" ADD COLUMN "semantic_version" text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE "hypotheses" ADD COLUMN "recommendation" text;--> statement-breakpoint
ALTER TABLE "hypotheses" ADD COLUMN "decision_thesis" text;--> statement-breakpoint
ALTER TABLE "hypotheses" ADD COLUMN "decision_basis" jsonb;--> statement-breakpoint
ALTER TABLE "hypotheses" ADD COLUMN "decision_confidence" double precision;--> statement-breakpoint
ALTER TABLE "hypotheses" ADD COLUMN "price_forecast" jsonb;--> statement-breakpoint
ALTER TABLE "hypotheses" ADD COLUMN "market_scenario" jsonb;--> statement-breakpoint
ALTER TABLE "hypotheses" ADD COLUMN "coverage_gaps" jsonb;--> statement-breakpoint
ALTER TABLE "hypotheses" ADD COLUMN "verdict_target" text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE "hypotheses" ADD COLUMN "forecast_verdict" text;--> statement-breakpoint
ALTER TABLE "hypothesis_reviews" ADD COLUMN "verdict_target" text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE "hypothesis_reviews" ADD COLUMN "forecast_verdict" text;--> statement-breakpoint
ALTER TABLE "hypothesis_reviews" ADD COLUMN "validation_issues" jsonb;--> statement-breakpoint
CREATE INDEX "hypothesis_evaluation_revisions_hypothesis_idx" ON "hypothesis_evaluation_revisions" ("hypothesis_id","computed_at");--> statement-breakpoint
ALTER TABLE "hypothesis_evaluation_revisions" ADD CONSTRAINT "hypothesis_evaluation_revisions_r6V8PJik6F3S_fkey" FOREIGN KEY ("hypothesis_id") REFERENCES "hypotheses"("id");