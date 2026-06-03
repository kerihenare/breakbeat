import type { DatabaseSync } from "node:sqlite";
import type { ResolvedIdentity } from "../search/tavily.ts";
import { AGGREGATOR_BLOCKLIST } from "../search/tavily.ts";
import { matchesHandlePrefix } from "./normalize.ts";

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
