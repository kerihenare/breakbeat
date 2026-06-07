import type { Exclusion } from "../exclusion";
import type { ResolvedIdentity } from "../resolved-identity";
import { matchesHandlePrefix } from "./normalize";

// ─── Blocklists (domain data) ──────────────────────────────────────────────

/**
 * Aggregators / link-farms excluded wholesale. Medium is deliberately absent
 * (it hosts original blog posts); Reddit is excluded despite being arguably
 * "social" (explicit exclusion wins; soft exclusion keeps it auditable).
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

/** Review/comparison site domains — excluded as ecommerce_review. */
export const REVIEW_DOMAINS: readonly string[] = [
	"g2.com",
	"capterra.com",
	"trustpilot.com",
	"trustradius.com",
	"getapp.com",
	"softwareadvice.com",
	"producthunt.com",
];

/** URL path segments indicating an ecommerce/review page (path-only). */
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

/** Anchored title patterns for ecommerce/review pages. `vs` is path-only. */
export const ECOMMERCE_TITLE_PATTERNS: readonly RegExp[] = [
	/^best .* (alternatives|tools|software)/i,
	/(review|comparison) of/i,
	/^top \d+/i,
];

// ─── Input ───────────────────────────────────────────────────────────────────

export type HeuristicInput = {
	readonly url: string;
	readonly title: string;
	readonly sourceDomain: string;
	readonly publishedDate: string | null;
};

// ─── Helpers ───────────────────────────────────────────────────────────────

function domainMatchesOwn(sourceDomain: string, ownDomain: string): boolean {
	const src = sourceDomain.toLowerCase();
	const own = ownDomain.toLowerCase().replace(/^www\./, "");
	return src === own || src.endsWith(`.${own}`);
}

function domainInList(sourceDomain: string, list: readonly string[]): boolean {
	const src = sourceDomain.toLowerCase();
	return list.some((entry) => {
		const e = entry.toLowerCase();
		return src === e || src.endsWith(`.${e}`);
	});
}

function urlPathIsEcommerce(url: string): boolean {
	let path: string;
	try {
		path = new URL(url).pathname.toLowerCase();
	} catch {
		path = url.toLowerCase();
	}
	return ECOMMERCE_PATH_SEGMENTS.some((segment) => path.includes(segment));
}

function titleIsEcommerce(title: string): boolean {
	return ECOMMERCE_TITLE_PATTERNS.some((pattern) => pattern.test(title));
}

// ─── heuristicExclusion ────────────────────────────────────────────────────

/**
 * Pure: evaluate a single result against the heuristic exclusion rules, in
 * order (own_channel → aggregator → ecommerce_review → out_of_window).
 * Returns an Exclusion or null (keep). Dateless results are kept.
 */
export function heuristicExclusion(
	input: HeuristicInput,
	identity: ResolvedIdentity,
	windowStart: Date,
): Exclusion | null {
	// Rule 1: own channel — own domain/subdomain, or own social handle prefix.
	for (const ownDomain of identity.domains) {
		if (domainMatchesOwn(input.sourceDomain, ownDomain)) {
			return { code: "own_channel", detail: ownDomain };
		}
	}
	for (const handle of identity.handles) {
		if (matchesHandlePrefix(handle, input.url)) {
			return { code: "own_channel", detail: handle };
		}
	}

	// Rule 2: aggregator.
	if (domainInList(input.sourceDomain, AGGREGATOR_BLOCKLIST)) {
		return { code: "aggregator", detail: input.sourceDomain };
	}

	// Rule 3: ecommerce / review — review domain, ecommerce path, or title pattern.
	if (domainInList(input.sourceDomain, REVIEW_DOMAINS)) {
		return { code: "ecommerce_review", detail: input.sourceDomain };
	}
	if (urlPathIsEcommerce(input.url)) {
		return { code: "ecommerce_review", detail: input.url };
	}
	if (titleIsEcommerce(input.title)) {
		return { code: "ecommerce_review", detail: input.title };
	}

	// Rule 4: out of window — published before windowStart (dateless kept).
	if (input.publishedDate !== null) {
		const published = new Date(input.publishedDate);
		if (!Number.isNaN(published.getTime()) && published < windowStart) {
			return { code: "out_of_window", detail: input.publishedDate };
		}
	}

	return null;
}
