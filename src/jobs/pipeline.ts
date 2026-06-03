import type { DatabaseSync } from "node:sqlite";
import { runSearch } from "../search/tavily.js";
import { transition } from "./queue.js";
import { resolve } from "./resolve.js";

// ─── Types ────────────────────────────────────────────────────────────────────

type JobRow = {
	id: number;
	company_id: number;
	status: string;
	window_start: string | null;
	window_end: string | null;
	resolved_name: string | null;
	resolved_domains: string;
	resolved_handles: string;
	resolution_provenance: string | null;
	error: string | null;
	created_at: string;
};

type ResolvedIdentity = {
	name: string;
	domains: string[];
	handles: string[];
	windowStart: string;
	windowEnd: string;
};

/**
 * Run the job pipeline end-to-end.
 *
 * Stages:
 * 1. Resolve: fetch homepage, extract handles, cascade heuristic/LLM/degraded if name-only.
 *    Computes and stores the 36-month window. Transitions to 'searching'.
 * 2. Search: build 18 queries from resolved identity, run all concurrently via Tavily,
 *    insert deduplicated results. Transitions to 'filtering'.
 * 3. Filter: stub — TODO: Task 13. Simple sleep + transition to 'classifying'.
 * 4. Classify: stub — TODO: Task 15. Simple sleep + finalize.
 *
 * Wraps the entire run in try/catch → transition(..., 'failed', message).
 */
export async function runPipeline(
	db: DatabaseSync,
	jobId: number,
): Promise<void> {
	try {
		// ─── Stage 1: Resolve ───────────────────────────────────────────────────
		// Computes window, fetches homepage, extracts handles.
		// Calls transition(db, jobId, 'searching') at the end.
		await resolve(db, jobId);

		// ─── Stage 2: Search ────────────────────────────────────────────────────
		// Fetch resolved identity from DB, build queries, run all concurrently.
		const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId) as
			| JobRow
			| undefined;

		if (!job) {
			throw new Error(`job not found after resolve: ${jobId}`);
		}

		// Construct resolved identity object
		const companyName = db
			.prepare(
				"SELECT c.name FROM companies c JOIN jobs j ON j.company_id = c.id WHERE j.id = ?",
			)
			.get(jobId) as { name: string } | undefined;

		const identity: ResolvedIdentity = {
			domains: JSON.parse(job.resolved_domains) as string[],
			handles: JSON.parse(job.resolved_handles) as string[],
			name: job.resolved_name ?? companyName?.name ?? "Unknown Company",
			windowEnd: job.window_end ?? "",
			windowStart: job.window_start ?? "",
		};

		await runSearch(db, job, identity);
		transition(db, jobId, "filtering");

		// ─── Stage 3: Filter ────────────────────────────────────────────────────
		// Stub for now. TODO: Task 13 will implement real filtering.
		await sleep(500);
		transition(db, jobId, "classifying");

		// ─── Stage 4: Classify ──────────────────────────────────────────────────
		// Stub for now. TODO: Task 15 will implement real classification.
		await sleep(500);

		// ─── Finalize ───────────────────────────────────────────────────────────
		finalize(db, jobId);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		transition(db, jobId, "failed", message);
	}
}

/**
 * Helper: check for warnings and transition to done or done_with_warnings.
 */
function finalize(db: DatabaseSync, jobId: number): void {
	const warningRow = db
		.prepare("SELECT COUNT(*) as count FROM warnings WHERE job_id = ?")
		.get(jobId) as { count: number } | undefined;

	const warningCount = warningRow?.count ?? 0;

	if (warningCount > 0) {
		transition(db, jobId, "done_with_warnings");
	} else {
		transition(db, jobId, "done");
	}
}

/**
 * Utility: sleep for ms milliseconds.
 */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
