ALTER TABLE "jobs" ADD COLUMN "chosen_domain" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "context_note" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "negative_matches" jsonb;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "resolved_domains" jsonb;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "resolved_handles" jsonb;