CREATE TABLE "bank_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"issuer_id" uuid NOT NULL,
	"form" integer NOT NULL,
	"report_date" date NOT NULL,
	"unit" text,
	"rows" jsonb NOT NULL,
	"available_at" timestamp with time zone NOT NULL,
	"content_hash" text NOT NULL,
	"provenance" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issuer_regulatory_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"issuer_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"available_at" timestamp with time zone NOT NULL,
	"content_hash" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "issuer_facts" ADD COLUMN "period_start" date;--> statement-breakpoint
ALTER TABLE "issuer_facts" ADD COLUMN "period_end" date;--> statement-breakpoint
ALTER TABLE "issuer_facts" ADD COLUMN "basis" text DEFAULT 'reported' NOT NULL;--> statement-breakpoint
ALTER TABLE "issuer_facts" ADD COLUMN "period_kind" text DEFAULT 'duration' NOT NULL;--> statement-breakpoint
ALTER TABLE "issuer_documents" ALTER COLUMN "published_at" DROP NOT NULL;--> statement-breakpoint
DROP INDEX "issuer_facts_metric_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "issuer_facts_metric_idx" ON "issuer_facts" ("document_id","metric_key","period_start","period_end","basis");--> statement-breakpoint
CREATE UNIQUE INDEX "bank_reports_version_idx" ON "bank_reports" ("issuer_id","form","report_date","available_at");--> statement-breakpoint
CREATE INDEX "bank_reports_asof_idx" ON "bank_reports" ("issuer_id","report_date","available_at");--> statement-breakpoint
CREATE UNIQUE INDEX "issuer_regulatory_version_idx" ON "issuer_regulatory_snapshots" ("issuer_id","available_at");--> statement-breakpoint
CREATE INDEX "issuer_regulatory_asof_idx" ON "issuer_regulatory_snapshots" ("issuer_id","available_at");--> statement-breakpoint
ALTER TABLE "bank_reports" ADD CONSTRAINT "bank_reports_issuer_id_issuers_id_fkey" FOREIGN KEY ("issuer_id") REFERENCES "issuers"("id");--> statement-breakpoint
ALTER TABLE "issuer_regulatory_snapshots" ADD CONSTRAINT "issuer_regulatory_snapshots_issuer_id_issuers_id_fkey" FOREIGN KEY ("issuer_id") REFERENCES "issuers"("id");