CREATE TABLE "data_sources" (
	"id" text PRIMARY KEY,
	"label" text NOT NULL,
	"source_url" text NOT NULL,
	"tier" text NOT NULL,
	"access_mode" text DEFAULT 'public' NOT NULL,
	"access_terms" text NOT NULL,
	"coverage" jsonb NOT NULL,
	"status" text DEFAULT 'not_covered' NOT NULL,
	"last_success_at" timestamp with time zone,
	"last_attempt_at" timestamp with time zone,
	"last_error_code" text
);
--> statement-breakpoint
CREATE TABLE "evidence_sync_locks" (
	"key" text PRIMARY KEY,
	"token" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instrument_issuers" (
	"instrument_id" uuid PRIMARY KEY,
	"issuer_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issuer_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"issuer_id" uuid NOT NULL,
	"source_id" text NOT NULL,
	"title" text NOT NULL,
	"reporting_standard" text NOT NULL,
	"consolidated" boolean NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"available_at" timestamp with time zone NOT NULL,
	"source_url" text NOT NULL,
	"content_hash" text NOT NULL,
	"revision_hash" text NOT NULL,
	"raw_base64" text NOT NULL,
	"mime_type" text NOT NULL,
	"extracted_text" text NOT NULL,
	"extractor_version" text NOT NULL,
	"verification" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issuer_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"document_id" uuid NOT NULL,
	"metric_key" text NOT NULL,
	"value" numeric NOT NULL,
	"unit" text NOT NULL,
	"original_unit" text NOT NULL,
	"locator" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issuers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" text NOT NULL,
	"inn" text NOT NULL UNIQUE,
	"ogrn" text,
	"reg_num" text,
	"int_code" text
);
--> statement-breakpoint
CREATE TABLE "macro_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"series_id" text NOT NULL,
	"period_date" date NOT NULL,
	"value" numeric NOT NULL,
	"published_at" timestamp with time zone,
	"available_at" timestamp with time zone NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"content_hash" text NOT NULL,
	"provenance" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "macro_series" (
	"id" text PRIMARY KEY,
	"source_id" text NOT NULL,
	"label" text NOT NULL,
	"unit" text NOT NULL,
	"periodicity" text NOT NULL,
	"methodology" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "regulatory_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"source_id" text NOT NULL,
	"external_id" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"category" text NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"available_at" timestamp with time zone NOT NULL,
	"content_hash" text NOT NULL,
	"provenance" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_fetches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"source_id" text NOT NULL,
	"source_url" text NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	"http_status" integer,
	"error_code" text,
	"duration_ms" integer NOT NULL,
	"content_hash" text,
	"etag" text,
	"last_modified" text,
	"raw_body" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX "issuer_documents_version_idx" ON "issuer_documents" ("issuer_id","content_hash","revision_hash");--> statement-breakpoint
CREATE INDEX "issuer_documents_period_idx" ON "issuer_documents" ("issuer_id","period_end","published_at");--> statement-breakpoint
CREATE UNIQUE INDEX "issuer_facts_metric_idx" ON "issuer_facts" ("document_id","metric_key");--> statement-breakpoint
CREATE UNIQUE INDEX "macro_observations_version_idx" ON "macro_observations" ("series_id","period_date","available_at");--> statement-breakpoint
CREATE INDEX "macro_observations_asof_idx" ON "macro_observations" ("series_id","period_date","available_at");--> statement-breakpoint
CREATE UNIQUE INDEX "regulatory_events_version_idx" ON "regulatory_events" ("source_id","external_id","available_at");--> statement-breakpoint
CREATE INDEX "regulatory_events_asof_idx" ON "regulatory_events" ("available_at","published_at");--> statement-breakpoint
CREATE INDEX "source_fetches_source_date_idx" ON "source_fetches" ("source_id","completed_at");--> statement-breakpoint
ALTER TABLE "instrument_issuers" ADD CONSTRAINT "instrument_issuers_instrument_id_instruments_id_fkey" FOREIGN KEY ("instrument_id") REFERENCES "instruments"("id");--> statement-breakpoint
ALTER TABLE "instrument_issuers" ADD CONSTRAINT "instrument_issuers_issuer_id_issuers_id_fkey" FOREIGN KEY ("issuer_id") REFERENCES "issuers"("id");--> statement-breakpoint
ALTER TABLE "issuer_documents" ADD CONSTRAINT "issuer_documents_issuer_id_issuers_id_fkey" FOREIGN KEY ("issuer_id") REFERENCES "issuers"("id");--> statement-breakpoint
ALTER TABLE "issuer_documents" ADD CONSTRAINT "issuer_documents_source_id_data_sources_id_fkey" FOREIGN KEY ("source_id") REFERENCES "data_sources"("id");--> statement-breakpoint
ALTER TABLE "issuer_facts" ADD CONSTRAINT "issuer_facts_document_id_issuer_documents_id_fkey" FOREIGN KEY ("document_id") REFERENCES "issuer_documents"("id");--> statement-breakpoint
ALTER TABLE "macro_observations" ADD CONSTRAINT "macro_observations_series_id_macro_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "macro_series"("id");--> statement-breakpoint
ALTER TABLE "macro_series" ADD CONSTRAINT "macro_series_source_id_data_sources_id_fkey" FOREIGN KEY ("source_id") REFERENCES "data_sources"("id");--> statement-breakpoint
ALTER TABLE "regulatory_events" ADD CONSTRAINT "regulatory_events_source_id_data_sources_id_fkey" FOREIGN KEY ("source_id") REFERENCES "data_sources"("id");--> statement-breakpoint
ALTER TABLE "source_fetches" ADD CONSTRAINT "source_fetches_source_id_data_sources_id_fkey" FOREIGN KEY ("source_id") REFERENCES "data_sources"("id");