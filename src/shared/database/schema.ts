import {
	index,
	jsonb,
	pgTable,
	text,
	timestamp,
	unique,
	uuid,
} from "drizzle-orm/pg-core";

// Domain persistence schema (Slice 2). Replaces the Slice-1 app_meta baseline.

export const jobs = pgTable("jobs", {
	// Resolved Identity (Slice 4) — nullable until the Resolve stage runs.
	chosenDomain: text("chosen_domain"),
	companyName: text("company_name").notNull(),
	contextNote: text("context_note"),
	createdAt: timestamp("created_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
	error: text("error"),
	homepageUrl: text("homepage_url"),
	id: uuid("id").primaryKey(),
	negativeMatches: jsonb("negative_matches").$type<string[]>(),
	provenance: text("provenance"),
	resolvedDomains: jsonb("resolved_domains").$type<string[]>(),
	resolvedHandles: jsonb("resolved_handles").$type<string[]>(),
	status: text("status").notNull().default("pending"),
	windowEnd: text("window_end").notNull(),
	windowStart: text("window_start").notNull(),
});

export const results = pgTable(
	"results",
	{
		confidence: text("confidence"),
		contentType: text("content_type"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		exclusionCode: text("exclusion_code"),
		exclusionDetail: text("exclusion_detail"),
		id: uuid("id").primaryKey(),
		jobId: uuid("job_id")
			.notNull()
			.references(() => jobs.id, { onDelete: "cascade" }),
		normalizedUrl: text("normalized_url").notNull(),
		publishedDate: text("published_date"),
		sentiment: text("sentiment"),
		sourceDomain: text("source_domain").notNull(),
		status: text("status").notNull().default("included"),
		title: text("title").notNull(),
		url: text("url").notNull(),
	},
	(t) => [
		unique("results_job_url_unique").on(t.jobId, t.normalizedUrl),
		index("results_job_idx").on(t.jobId),
	],
);

export const warnings = pgTable("warnings", {
	createdAt: timestamp("created_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
	id: uuid("id").primaryKey(),
	jobId: uuid("job_id")
		.notNull()
		.references(() => jobs.id, { onDelete: "cascade" }),
	message: text("message").notNull(),
});
