import type { DatabaseSync } from "node:sqlite";
import type { ResolvedIdentity } from "../search/tavily.ts";
import { AGGREGATOR_BLOCKLIST } from "../search/tavily.ts";
import { matchesHandlePrefix, normalizeTitle } from "./normalize.ts";

// ─── Exported constants ───────────────────────────────────────────────────────

/**
 * Review/comparison site domains — excluded as ecommerce_review.
 * producthunt.com is included: launch pages are review/aggregator-shaped.
 */
export const REVIEW_DOMAINS: readonly string[] = [
	"g2.com",
	"capterra.com",
	"trustpilot.com",
	"trustradius.com",
	"getapp.com",
	"softwareadvice.com",
	"producthunt.com",
];

/**
 * URL path segments that indicate an ecommerce or review page.
 * Each is a full path component (wrapped in `/`), so `/vs/` never matches a
 * title — it's a PATH PATTERN ONLY.
 */
export const ECOMMERCE_PATH_SEGMENTS: readonly string[] = [
	"/product/",
	"/products/",
	"/shop/",
	"/store/",
	"/buy/",
	"/pricing/",
	"/vs/",
	"/compare/",
	"/alternatives/",
];

/**
 * Anchored title patterns for ecommerce/review pages.
 * `^top \d+` is anchored — "Top 10 fintech stories" mid-title passes.
 * `vs` is intentionally absent — it's a path pattern only.
 */
export const ECOMMERCE_TITLE_PATTERNS: readonly RegExp[] = [
	/^best .* (alternatives|tools|software)/i,
	/(review|comparison) of/i,
	/^top \d+/i,
];

// ─── Types ────────────────────────────────────────────────────────────────────

type ExclusionCode =
	| "own_channel"
	| "aggregator"
	| "ecommerce_review"
	| "out_of_window";

type Exclusion = {
	code: ExclusionCode;
	detail: string | null;
};

type ResultLike = {
	id: number;
	url: string;
	title: string;
	source_domain: string;
	published_date: string | null;
	status: "included" | "excluded";
	exclusion_code: string | null;
	exclusion_detail: string | null;
	content_type: string | null;
	confidence: string | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Check if a domain (the result's source_domain) matches an own domain or
 * any of its subdomains.
 *
 * "acme.com" blocks "acme.com" and "blog.acme.com" but NOT "notacme.com".
 */
function domainMatchesOwn(sourceDomain: string, ownDomain: string): boolean {
	const src = sourceDomain.toLowerCase();
	const own = ownDomain.toLowerCase().replace(/^www\./, "");
	return src === own || src.endsWith(`.${own}`);
}

/**
 * Check if a domain (the result's source_domain) matches an aggregator
 * blocklist entry or is a subdomain of one.
 */
function domainIsAggregator(sourceDomain: string): boolean {
	const src = sourceDomain.toLowerCase();
	for (const blocked of AGGREGATOR_BLOCKLIST) {
		const b = blocked.toLowerCase();
		if (src === b || src.endsWith(`.${b}`)) {
			return true;
		}
	}
	return false;
}

/**
 * Check if a domain matches a review/comparison site domain.
 */
function domainIsReview(sourceDomain: string): boolean {
	const src = sourceDomain.toLowerCase();
	for (const reviewDomain of REVIEW_DOMAINS) {
		if (src === reviewDomain || src.endsWith(`.${reviewDomain}`)) {
			return true;
		}
	}
	return false;
}

/**
 * Check if a URL path contains any of the ecommerce path segments.
 */
function urlPathIsEcommerce(url: string): boolean {
	let path: string;
	try {
		path = new URL(url).pathname.toLowerCase();
	} catch {
		path = url.toLowerCase();
	}
	for (const segment of ECOMMERCE_PATH_SEGMENTS) {
		if (path.includes(segment)) {
			return true;
		}
	}
	return false;
}

/**
 * Check if a title matches any of the anchored ecommerce/review patterns.
 */
function titleIsEcommerce(title: string): boolean {
	for (const pattern of ECOMMERCE_TITLE_PATTERNS) {
		if (pattern.test(title)) {
			return true;
		}
	}
	return false;
}

// ─── heuristicExclusion ───────────────────────────────────────────────────────

/**
 * Pure function: evaluate a single result against heuristic exclusion rules.
 *
 * Returns an Exclusion { code, detail } if the result should be excluded,
 * or null if it should be kept.
 *
 * Rules applied in order:
 *   1. own_channel  — result's domain matches own domains/subdomains, or URL
 *                     prefix-matches an own social handle
 *   2. aggregator   — result's domain is in the aggregator blocklist
 *   3. ecommerce_review — review-site domain, ecommerce URL path, or
 *                         anchored title pattern
 *   4. out_of_window — result has a published_date before windowStart
 *                      (dateless results are KEPT)
 */
export function heuristicExclusion(
	result: ResultLike,
	identity: ResolvedIdentity,
	windowStart: Date,
): Exclusion | null {
	// ── Rule 1: Own channel ──────────────────────────────────────────────────

	// 1a. Own domain or subdomain
	for (const ownDomain of identity.domains) {
		if (domainMatchesOwn(result.source_domain, ownDomain)) {
			return { code: "own_channel", detail: ownDomain };
		}
	}

	// 1b. Own social handle prefix
	for (const handle of identity.handles) {
		if (matchesHandlePrefix(handle, result.url)) {
			return { code: "own_channel", detail: handle };
		}
	}

	// ── Rule 2: Aggregator ───────────────────────────────────────────────────

	if (domainIsAggregator(result.source_domain)) {
		return { code: "aggregator", detail: result.source_domain };
	}

	// ── Rule 3: Ecommerce / review ────────────────────────────────────────────

	if (domainIsReview(result.source_domain)) {
		return { code: "ecommerce_review", detail: result.source_domain };
	}

	if (urlPathIsEcommerce(result.url)) {
		return { code: "ecommerce_review", detail: result.url };
	}

	if (titleIsEcommerce(result.title)) {
		return { code: "ecommerce_review", detail: result.title };
	}

	// ── Rule 4: Out of window ─────────────────────────────────────────────────

	if (result.published_date !== null) {
		const published = new Date(result.published_date);
		// If the date is invalid, treat as dateless → keep
		if (!Number.isNaN(published.getTime()) && published < windowStart) {
			return {
				code: "out_of_window",
				detail: result.published_date,
			};
		}
	}

	return null;
}

// ─── applyHeuristics ─────────────────────────────────────────────────────────

/**
 * Impure: load all included results for the job, run heuristicExclusion on
 * each, and UPDATE the DB row for any that should be excluded.
 */
export function applyHeuristics(
	db: DatabaseSync,
	jobId: number,
	identity: ResolvedIdentity,
): void {
	const windowStart = new Date(identity.windowStart);

	const rows = db
		.prepare(
			`SELECT id, url, title, source_domain, published_date,
			        status, exclusion_code, exclusion_detail, content_type, confidence
			 FROM results
			 WHERE job_id = ? AND status = 'included'`,
		)
		.all(jobId) as ResultLike[];

	const update = db.prepare(
		`UPDATE results
		 SET status = 'excluded', exclusion_code = ?, exclusion_detail = ?
		 WHERE id = ?`,
	);

	for (const row of rows) {
		const exclusion = heuristicExclusion(row, identity, windowStart);
		if (exclusion !== null) {
			update.run(exclusion.code, exclusion.detail, row.id);
		}
	}
}

// ─── collapse ─────────────────────────────────────────────────────────────────

type CollapseRow = {
	id: number;
	title: string;
	published_date: string | null;
	normalized_url: string;
};

const COLLAPSE_MIN_TITLE_LEN = 25;
const COLLAPSE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000; // 14 days in milliseconds

/**
 * Deduplicate near-identical results within the same job by normalized title.
 *
 * Only operates on still-`included` results. Losers are marked:
 *   status='excluded', exclusion_code='duplicate', exclusion_detail='of #<winner.id>'
 *
 * Algorithm:
 *   1. Normalize each title; skip if < 25 chars.
 *   2. Group by normalized title; groups with 1 member are ignored.
 *   3. Split each group into DATED (published_date != null) and UNDATED subsets.
 *   4. Cluster DATED results using anchor-on-earliest (14-day window, no chaining).
 *   5. Winner per cluster = anchor (earliest date); losers → excluded/duplicate.
 *   6. UNDATED results:
 *      - 0 or 1 dated clusters: join the cluster (winner = dated anchor if any, else lowest id).
 *      - 2+ dated clusters: stay included (ambiguous which story they belong to).
 */
export function collapse(db: DatabaseSync, jobId: number): void {
	const rows = db
		.prepare(
			`SELECT id, title, published_date, normalized_url
			 FROM results
			 WHERE job_id = ? AND status = 'included'`,
		)
		.all(jobId) as CollapseRow[];

	const update = db.prepare(
		`UPDATE results
		 SET status = 'excluded', exclusion_code = 'duplicate', exclusion_detail = ?
		 WHERE id = ?`,
	);

	// Step 1 & 2: normalize titles and group
	const groups = new Map<string, CollapseRow[]>();

	for (const row of rows) {
		const norm = normalizeTitle(row.title);
		if (norm.length < COLLAPSE_MIN_TITLE_LEN) {
			continue; // skip short titles
		}
		const existing = groups.get(norm);
		if (existing === undefined) {
			groups.set(norm, [row]);
		} else {
			existing.push(row);
		}
	}

	for (const group of groups.values()) {
		if (group.length < 2) {
			continue; // singleton — nothing to collapse
		}

		// Step 3: split into dated and undated
		const dated = group.filter((r) => r.published_date !== null);
		const undated = group.filter((r) => r.published_date === null);

		// Step 4: cluster dated results using anchor-on-earliest (sort ASC first)
		dated.sort((a, b) => {
			// Both are non-null here (typed above, but TS needs the guard)
			const ta = new Date(a.published_date as string).getTime();
			const tb = new Date(b.published_date as string).getTime();
			return ta - tb;
		});

		// clusters: each element is [anchor, ...rest]
		const clusters: CollapseRow[][] = [];

		for (const result of dated) {
			const t = new Date(result.published_date as string).getTime();
			// Find the first cluster whose anchor is within 14 days of this result
			let placed = false;
			for (const cluster of clusters) {
				const anchorTime = new Date(
					cluster[0].published_date as string,
				).getTime();
				if (t - anchorTime <= COLLAPSE_WINDOW_MS) {
					cluster.push(result);
					placed = true;
					break;
				}
			}
			if (!placed) {
				clusters.push([result]);
			}
		}

		// Step 5: winner per cluster = anchor (index 0); losers → excluded
		for (const cluster of clusters) {
			if (cluster.length < 2) {
				continue; // singleton cluster — no losers
			}
			const winner = cluster[0];
			for (let i = 1; i < cluster.length; i++) {
				update.run(`of #${winner.id}`, cluster[i].id);
			}
		}

		// Step 6: handle undated results
		if (undated.length === 0) {
			continue;
		}

		const dateClusters = clusters.length;

		if (dateClusters >= 2) {
			// Ambiguous — undated results stay included
			continue;
		}

		// 0 or 1 dated clusters: undated results join
		// Winner: the dated anchor if 1 cluster exists, else lowest id among undated
		let undatedWinner: CollapseRow;

		if (dateClusters === 1) {
			// The dated anchor (cluster[0][0]) is the winner for the whole group
			const dateWinner = clusters[0][0];
			for (const u of undated) {
				update.run(`of #${dateWinner.id}`, u.id);
			}
		} else {
			// 0 dated clusters — all-undated group: winner = lowest id
			undated.sort((a, b) => a.id - b.id);
			undatedWinner = undated[0];
			for (let i = 1; i < undated.length; i++) {
				update.run(`of #${undatedWinner.id}`, undated[i].id);
			}
		}
	}
}
