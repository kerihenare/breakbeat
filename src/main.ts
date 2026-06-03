import { join } from "node:path";
import express from "express";
import nunjucks from "nunjucks";
import { getDb } from "./db.ts";
import { runPipeline } from "./jobs/pipeline.ts";
import { createQueue } from "./jobs/queue.ts";
import { createJobsRouter } from "./routes/jobs.ts";

// ─── Required environment variables ──────────────────────────────────────────

const REQUIRED_KEYS = ["ANTHROPIC_API_KEY", "TAVILY_API_KEY"] as const;
const missing = REQUIRED_KEYS.filter((k) => !process.env[k]);
if (missing.length > 0) {
	console.error(
		`Missing required environment variable(s): ${missing.join(", ")}`,
	);
	console.error("Copy .env.example → .env and set the missing key(s).");
	process.exit(1);
}

// ─── App setup ────────────────────────────────────────────────────────────────

const app = express();
const PORT = Number(process.env.PORT ?? 3000);

// ─── Nunjucks ─────────────────────────────────────────────────────────────────

const nunjucksEnv = nunjucks.configure(join(import.meta.dirname, "views"), {
	autoescape: true,
	express: app,
	noCache: process.env.NODE_ENV !== "production",
});

/**
 * where(arr, attr, value) — strict-equality filter for template use.
 *
 * Nunjucks' built-in selectattr/rejectattr are 2-arg filters that only check
 * truthiness (!!item[attr]). The 3-arg Jinja2 form (attr, test, value) is not
 * implemented in Nunjucks 3.x — the extra arguments are silently ignored.
 * This custom filter provides proper equality filtering:
 *   {{ results | where('status', 'included') }}
 */
nunjucksEnv.addFilter(
	"where",
	(arr: unknown[], attr: string, value: unknown) => {
		if (!Array.isArray(arr)) return [];
		return arr.filter(
			(item) => (item as Record<string, unknown>)[attr] === value,
		);
	},
);

/**
 * whereNot(arr, attr, value) — strict-inequality filter for template use.
 *
 * Keeps items where item[attr] !== value (strict).
 *   {{ results | whereNot('published_date', null) }}  → dated rows only
 *   {{ results | where('published_date', null) }}     → undated rows only
 */
nunjucksEnv.addFilter(
	"whereNot",
	(arr: unknown[], attr: string, value: unknown) => {
		if (!Array.isArray(arr)) return [];
		return arr.filter(
			(item) => (item as Record<string, unknown>)[attr] !== value,
		);
	},
);

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(express.urlencoded({ extended: false }));
app.use(express.static(join(import.meta.dirname, "..", "public")));

// ─── DB + queue ───────────────────────────────────────────────────────────────

const db = getDb();
const { enqueue } = createQueue((jobId) => runPipeline(db, jobId));

// ─── Boot re-enqueue ──────────────────────────────────────────────────────────

const pendingJobs = db
	.prepare("SELECT id FROM jobs WHERE status = 'pending' ORDER BY id")
	.all() as Array<{ id: number }>;
for (const job of pendingJobs) {
	enqueue(job.id);
}

// ─── Routes ───────────────────────────────────────────────────────────────────

app.use("/", createJobsRouter(db, enqueue));

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
	console.log(`Breakbeat running at http://localhost:${PORT}`);
});
