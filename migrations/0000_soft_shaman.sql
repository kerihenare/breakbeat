CREATE TABLE "jobs" (
	"company_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"error" text,
	"homepage_url" text,
	"id" uuid PRIMARY KEY NOT NULL,
	"provenance" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"window_end" text NOT NULL,
	"window_start" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "results" (
	"confidence" text,
	"content_type" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"exclusion_code" text,
	"exclusion_detail" text,
	"id" uuid PRIMARY KEY NOT NULL,
	"job_id" uuid NOT NULL,
	"normalized_url" text NOT NULL,
	"published_date" text,
	"sentiment" text,
	"source_domain" text NOT NULL,
	"status" text DEFAULT 'included' NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	CONSTRAINT "results_job_url_unique" UNIQUE("job_id","normalized_url")
);
--> statement-breakpoint
CREATE TABLE "warnings" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"job_id" uuid NOT NULL,
	"message" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "results" ADD CONSTRAINT "results_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warnings" ADD CONSTRAINT "warnings_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "results_job_idx" ON "results" USING btree ("job_id");