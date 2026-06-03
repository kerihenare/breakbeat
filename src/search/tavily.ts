import type { DatabaseSync } from "node:sqlite";
import type { TavilySearchOptions } from "@tavily/core";
import { tavily } from "@tavily/core";
import { addWarning } from "../jobs/queue.ts";

// ─── Constants ────────────────────────────────────────────────────────────────

export const MAX_QUERIES = 20;
const MAX_RESULTS_PER_QUERY = 20;
export const CLASSIFY_CAP = 400;
export const CLASSIFY_CHUNK_SIZE = 50;

/**
 * Aggregator sites excluded from every query.
 * Medium is deliberately NOT listed.
 */
export const AGGREGATOR_BLOCKLIST: readonly string[] = [
	"news.ycombinator.com",
	"reddit.com",
	"slashdot.org",
	"lobste.rs",
	"digg.com",
	"flipboard.com",
	"feedly.com",
	"news.google.com",
	"apple.news",
];

// ─── Types ────────────────────────────────────────────────────────────────────

export type ResolvedIdentity = {
	name: string;
	domains: string[];
	handles: string[];
	windowStart: string;
	windowEnd: string;
};

export type TavilyQuery = {
	query: string;
	options: TavilySearchOptions;
};

// ─── buildQueries ─────────────────────────────────────────────────────────────

/**
 * Build the full set of Tavily queries for a search job.
 *
 * Generates EXACTLY 18 queries in three groups:
 *   7 per-content-type queries
 *   6 time-sliced queries (news + press release × 3 slices)
 *   5 angle queries
 *
 * Pure function — no side effects, fully testable.
 */
export function buildQueries(
	identity: ResolvedIdentity,
	windowStart: string,
	windowEnd: string,
): TavilyQuery[] {
	const name = identity.name;

	// Build excludeDomains: own domains + aggregator blocklist
	const excludeDomains = [
		...identity.domains,
		...identity.handles
			.map((h) => {
				try {
					return new URL(h).hostname.toLowerCase().replace(/^www\./, "");
				} catch {
					return null;
				}
			})
			.filter((d): d is string => d !== null),
		...AGGREGATOR_BLOCKLIST,
	];

	// Deduplicate while preserving order
	const seen = new Set<string>();
	const deduped: string[] = [];
	for (const d of excludeDomains) {
		if (!seen.has(d)) {
			seen.add(d);
			deduped.push(d);
		}
	}
	const finalExclude = deduped;

	const queries: TavilyQuery[] = [];

	// ─── Group 1: Per content type (7 queries) ────────────────────────────────
	//
	// News and press release: topic "news", date bounds
	// Others: topic "general", timeRange "year" (best-effort 1-year filter;
	//   Tavily's timeRange has no "3y" option — "year" is closest, and these
	//   queries are best-effort anyway per the spec)

	const newsTypes = ["news", "press release"] as const;

	const generalTypes = [
		"podcast interview",
		"blog post",
		"newsletter",
		"trade publication",
		"social media",
	] as const;

	for (const suffix of newsTypes) {
		queries.push({
			options: {
				endDate: windowEnd,
				excludeDomains: finalExclude,
				maxResults: MAX_RESULTS_PER_QUERY,
				searchDepth: "advanced",
				startDate: windowStart,
				topic: "news",
			},
			query: `${name} ${suffix}`,
		});
	}

	for (const suffix of generalTypes) {
		queries.push({
			options: {
				excludeDomains: finalExclude,
				maxResults: MAX_RESULTS_PER_QUERY,
				searchDepth: "advanced",
				timeRange: "year",
				topic: "general",
			},
			query: `${name} ${suffix}`,
		});
	}

	// ─── Group 2: Time-sliced queries (6 queries) ─────────────────────────────
	//
	// News and press releases only, one query per 12-month slice.
	// Slices tile EXACTLY:
	//   slice 1: windowStart → windowStart+12m
	//   slice 2: windowStart+12m → windowStart+24m
	//   slice 3: windowStart+24m → windowEnd (= windowStart+36m)

	const slice1Start = windowStart;
	const slice1End = addMonths(windowStart, 12);
	const slice2Start = slice1End;
	const slice2End = addMonths(windowStart, 24);
	const slice3Start = slice2End;
	const slice3End = windowEnd;

	const slices = [
		{ end: slice1End, start: slice1Start },
		{ end: slice2End, start: slice2Start },
		{ end: slice3End, start: slice3Start },
	];

	const sliceTypes = ["news", "press release"] as const;

	for (const slice of slices) {
		for (const type of sliceTypes) {
			queries.push({
				options: {
					endDate: slice.end,
					excludeDomains: finalExclude,
					maxResults: MAX_RESULTS_PER_QUERY,
					searchDepth: "advanced",
					startDate: slice.start,
					topic: "news",
				},
				query: `${name} ${type}`,
			});
		}
	}

	// ─── Group 3: Angle queries (5 queries) ───────────────────────────────────

	const angles = [
		"funding",
		"acquisition",
		"leadership interview",
		"partnership",
		"lawsuit OR controversy",
	] as const;

	for (const angle of angles) {
		queries.push({
			options: {
				excludeDomains: finalExclude,
				maxResults: MAX_RESULTS_PER_QUERY,
				searchDepth: "advanced",
				timeRange: "year",
				topic: "general",
			},
			query: `${name} ${angle}`,
		});
	}

	return queries;
}

// ─── addMonths ────────────────────────────────────────────────────────────────

/**
 * Add N calendar months to a YYYY-MM-DD date string.
 * Clamps to valid month-end (e.g. Jan 31 + 1 month → Feb 28/29).
 */
function addMonths(dateStr: string, months: number): string {
	const [yearStr, monthStr, dayStr] = dateStr.split("-");
	const year = parseInt(yearStr, 10);
	const month = parseInt(monthStr, 10); // 1-based
	const day = parseInt(dayStr, 10);

	let newYear = year;
	let newMonth = month + months;
	while (newMonth > 12) {
		newMonth -= 12;
		newYear += 1;
	}

	// Clamp day to valid month-end
	const daysInMonth = new Date(Date.UTC(newYear, newMonth, 0)).getUTCDate();
	const clampedDay = Math.min(day, daysInMonth);

	return `${String(newYear).padStart(4, "0")}-${String(newMonth).padStart(2, "0")}-${String(clampedDay).padStart(2, "0")}`;
}

// ─── normalizeUrl ─────────────────────────────────────────────────────────────

/**
 * Normalize a URL for dedup purposes (DB unique constraint key).
 *
 * Rules (per spec §3):
 * 1. Lowercase host, strip www.
 * 2. Drop scheme — http and https copies collapse
 * 3. Strip fragment
 * 4. Strip known tracking params (utm_*, fbclid, gclid, mc_cid, ref, source)
 * 5. Sort remaining query params
 * 6. Strip trailing slash on path; preserve path case
 */
export function normalizeUrl(rawUrl: string): string {
	let parsed: URL;
	try {
		parsed = new URL(rawUrl);
	} catch {
		// Unparseable — return lowercased as-is
		return rawUrl.toLowerCase();
	}

	// 1. Lowercase host, strip www.
	const host = parsed.hostname.toLowerCase().replace(/^www\./, "");

	// 2. Drop scheme (use host as prefix without scheme)
	// 3. Strip fragment (URL constructor already omits it when we build the key)
	// 4. Strip known tracking params
	const TRACKING_PARAMS = new Set([
		"fbclid",
		"gclid",
		"mc_cid",
		"ref",
		"source",
	]);
	const cleanParams = new URLSearchParams();
	for (const [k, v] of parsed.searchParams.entries()) {
		if (k.startsWith("utm_") || TRACKING_PARAMS.has(k)) {
			continue;
		}
		cleanParams.append(k, v);
	}

	// 5. Sort remaining params
	cleanParams.sort();

	// 6. Strip trailing slash on path
	const path = parsed.pathname.replace(/\/$/, "");

	// Build the normalized key (no scheme, no fragment)
	const paramStr = cleanParams.toString();
	const key = paramStr ? `${host}${path}?${paramStr}` : `${host}${path}`;

	return key;
}

// ─── runSearch ────────────────────────────────────────────────────────────────

type JobRow = {
	id: number;
};

/**
 * Run all search queries and insert results into the DB.
 *
 * Fires all queries concurrently via Promise.allSettled.
 * Failed queries → addWarning. If ALL fail → throws (stage failure).
 *
 * Each result hit is inserted with INSERT OR IGNORE (URL dedup at insert time).
 */
export async function runSearch(
	db: DatabaseSync,
	job: JobRow,
	identity: ResolvedIdentity,
): Promise<void> {
	const queries = buildQueries(
		identity,
		identity.windowStart,
		identity.windowEnd,
	);
	const totalQueries = queries.length;

	const client = tavily({ apiKey: process.env.TAVILY_API_KEY ?? "" });

	// Fire all queries concurrently
	const results = await Promise.allSettled(
		queries.map(({ query, options }) => client.search(query, options)),
	);

	let succeeded = 0;
	let failed = 0;

	const insertResult = db.prepare(`
		INSERT OR IGNORE INTO results
			(job_id, url, normalized_url, title, snippet, source_domain, published_date)
		VALUES
			(?, ?, ?, ?, ?, ?, ?)
	`);

	for (const result of results) {
		if (result.status === "rejected") {
			failed++;
			continue;
		}

		succeeded++;
		const response = result.value;

		for (const hit of response.results ?? []) {
			const url = hit.url;
			if (!url) continue;

			const normalizedUrl = normalizeUrl(url);

			// Extract source domain
			let sourceDomain: string;
			try {
				sourceDomain = new URL(url).hostname
					.toLowerCase()
					.replace(/^www\./, "");
			} catch {
				sourceDomain = url;
			}

			// published_date may be empty string or missing
			const publishedDate = hit.publishedDate || null;

			try {
				insertResult.run(
					job.id,
					url,
					normalizedUrl,
					hit.title ?? "",
					hit.content ?? null,
					sourceDomain,
					publishedDate,
				);
			} catch {
				// INSERT OR IGNORE handles unique constraint; other errors are swallowed
				// to not abort the whole stage over one bad row
			}
		}
	}

	if (failed > 0) {
		addWarning(db, job.id, `${failed}/${totalQueries} search queries failed`);
	}

	if (succeeded === 0) {
		throw new Error("all search queries failed — no results fetched");
	}
}
