ALTER TABLE "issuer_reports" ADD COLUMN "document_url" text;--> statement-breakpoint
ALTER TABLE "issuer_reports" ADD COLUMN "available_at" timestamp with time zone DEFAULT now() NOT NULL;