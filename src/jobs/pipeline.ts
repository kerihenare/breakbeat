import type { DatabaseSync } from "node:sqlite";
import { transition } from "./queue.js";

/**
 * Run the job pipeline end-to-end.
 *
 * This is a stub implementation that walks the state machine with hard-coded data:
 * - pending → resolving → searching → filtering → classifying → done|done_with_warnings|failed
 *
 * Each stage is separated by ~1.5s setTimeout, and the fake Search stage inserts ~8 results
 * (some sharing normalized URLs to show the unique constraint), Filter excludes one as an
 * aggregator, and finalize checks for warnings to decide done vs done_with_warnings.
 *
 * Wraps the entire run in try/catch → transition(..., 'failed', message).
 *
 * Note: This is throwaway scaffolding, completely replaced in Tasks 10, 13, 15.
 */
export async function runPipeline(
	db: DatabaseSync,
	jobId: number,
): Promise<void> {
	try {
		// ─── Resolving stage ─────────────────────────────────────────────────────
		transition(db, jobId, "resolving");

		await sleep(1500);

		// ─── Searching stage ─────────────────────────────────────────────────────
		transition(db, jobId, "searching");

		// Insert ~8 hard-coded results with varied domains and titles.
		// Two of them share a normalized_url to show the UNIQUE constraint firing.
		const fakeResults = [
			{
				normalized_url: "techcrunch.com/article/example-company-funding",
				published_date: "2026-05-15",
				snippet: "The startup announced a new funding round...",
				source_domain: "techcrunch.com",
				title: "Example Company Raises $10M Series A",
				url: "https://www.techcrunch.com/article/example-company-funding",
			},
			{
				normalized_url: "venturebeat.com/article/example-company-series-a",
				published_date: "2026-05-16",
				snippet: "The company announced a new funding round led by...",
				source_domain: "venturebeat.com",
				title: "Example Company Lands $10M Series A Investment",
				url: "https://venturebeat.com/article/example-company-series-a",
			},
			{
				normalized_url: "wired.com/article/example-company-news",
				published_date: "2026-04-20",
				snippet: "The team spent months developing this feature...",
				source_domain: "wired.com",
				title: "Inside Example Company's New Product Launch",
				url: "https://wired.com/article/example-company-news",
			},
			{
				normalized_url: "forbes.com/article/example-company-founders",
				published_date: "2026-03-10",
				snippet: "An exclusive interview with the founding team...",
				source_domain: "forbes.com",
				title: "How Example Company's Founders Built a Billion-Dollar Vision",
				url: "https://forbes.com/article/example-company-founders",
			},
			{
				normalized_url: "theregister.com/article/example-company-tech",
				published_date: "2026-02-28",
				snippet: "Independent benchmarks show the company's latest...",
				source_domain: "theregister.com",
				title: "Example Company's New AI Model Outperforms Competitors",
				url: "https://theregister.com/article/example-company-tech",
			},
			{
				normalized_url: "arstechnica.com/article/example-company-analysis",
				published_date: "2026-01-15",
				snippet: "Technical analysis of the company's infrastructure...",
				source_domain: "arstechnica.com",
				title: "A Deep Dive Into Example Company's Architecture",
				url: "https://arstechnica.com/article/example-company-analysis",
			},
			{
				normalized_url: "news.example-aggregator.com/story/123",
				published_date: "2026-05-01",
				snippet: "A summary of recent news about the company...",
				source_domain: "news.example-aggregator.com",
				title: "Example Company News Roundup",
				url: "https://news.example-aggregator.com/story/123",
			},
			{
				normalized_url: "techcrunch.com/article/example-company-funding",
				published_date: "2026-05-15",
				snippet: "The startup announced a new funding round...",
				source_domain: "techcrunch.com",
				title: "Example Company Raises $10M Series A (tracked link)",
				// This one shares a normalized_url with techcrunch (above) to show unique constraint
				url: "https://techcrunch.com/article/example-company-funding?utm_source=twitter",
			},
		];

		// Insert each result with INSERT OR IGNORE to handle the unique constraint
		const insertStmt = db.prepare(
			`INSERT OR IGNORE INTO results
			 (job_id, url, normalized_url, title, snippet, source_domain, published_date)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		);

		for (const result of fakeResults) {
			insertStmt.run(
				jobId,
				result.url,
				result.normalized_url,
				result.title,
				result.snippet,
				result.source_domain,
				result.published_date,
			);
		}

		await sleep(1500);

		// ─── Filtering stage ─────────────────────────────────────────────────────
		transition(db, jobId, "filtering");

		// Mark the aggregator result as excluded
		db.prepare(
			`UPDATE results
			 SET status = 'excluded', exclusion_code = 'aggregator'
			 WHERE job_id = ? AND source_domain = 'news.example-aggregator.com'`,
		).run(jobId);

		await sleep(1500);

		// ─── Classifying stage ──────────────────────────────────────────────────
		transition(db, jobId, "classifying");

		// Fake classify: in a real implementation, this would call Claude Haiku.
		// For now, we just mark results as included (no-op for this stub).

		await sleep(1500);

		// ─── Finalize ──────────────────────────────────────────────────────────
		// Check if any warnings exist; if so, finish with 'done_with_warnings'.
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
