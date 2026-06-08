import type { ResolvedIdentity } from "../resolved-identity";
import { AGGREGATOR_BLOCKLIST } from "./heuristics";

export type SearchTopic = "news" | "general";

// Neutral search options — the domain stays Tavily-free; the adapter maps these
// onto the provider's option shape.
export type SearchOptions = {
	topic: SearchTopic;
	searchDepth: "advanced";
	maxResults: number;
	excludeDomains: string[];
	startDate?: string;
	endDate?: string;
	timeRange?: "year";
};

export type SearchQuery = {
	query: string;
	options: SearchOptions;
};

const MAX_RESULTS_PER_QUERY = 20;

/** Add N calendar months to a YYYY-MM-DD string, clamping to month-end. */
function addMonths(dateStr: string, months: number): string {
	const [yearStr, monthStr, dayStr] = dateStr.split("-");
	const year = Number.parseInt(yearStr, 10);
	const month = Number.parseInt(monthStr, 10);
	const day = Number.parseInt(dayStr, 10);
	let newYear = year;
	let newMonth = month + months;
	while (newMonth > 12) {
		newMonth -= 12;
		newYear += 1;
	}
	const daysInMonth = new Date(Date.UTC(newYear, newMonth, 0)).getUTCDate();
	const clampedDay = Math.min(day, daysInMonth);
	return `${String(newYear).padStart(4, "0")}-${String(newMonth).padStart(2, "0")}-${String(clampedDay).padStart(2, "0")}`;
}

function hostOf(handleUrl: string): string | null {
	try {
		return new URL(handleUrl).hostname.toLowerCase().replace(/^www\./, "");
	} catch {
		return null;
	}
}

/**
 * Hosts shared by many entities, where a company occupies a path rather than
 * the whole host. Never excluded wholesale at search time — that would drop
 * third-party coverage on the platform; the company's own profile is removed
 * later by the matchesHandlePrefix own_channel filter (path-level).
 */
const SHARED_PLATFORM_HOSTS: ReadonlySet<string> = new Set([
	"linkedin.com",
	"instagram.com",
	"facebook.com",
	"x.com",
	"twitter.com",
	"youtube.com",
	"tiktok.com",
	"medium.com",
	"substack.com",
	"threads.net",
]);

/**
 * The full Tavily-bound query set for a Job: 7 per-content-type + 6 time-sliced
 * (news/press release × 3 slices) + 5 angle queries = 18. Pure (ported from v1).
 * excludeDomains = own domains + dedicated (non-shared-platform) handle hosts +
 * aggregator blocklist + negative-match company domains (deduped,
 * order-preserved). Own profiles on shared platforms are dropped later by the
 * matchesHandlePrefix own_channel filter, not here.
 */
export function buildSearchQueries(identity: ResolvedIdentity): SearchQuery[] {
	const { name, window } = identity;
	const windowStart = window.start;
	const windowEnd = window.end;

	const excludeRaw = [
		...identity.domains,
		...identity.handles
			.map(hostOf)
			.filter((d): d is string => d !== null && !SHARED_PLATFORM_HOSTS.has(d)),
		...AGGREGATOR_BLOCKLIST,
		...identity.negativeMatches,
	];
	const excludeDomains = [...new Set(excludeRaw)];

	const queries: SearchQuery[] = [];

	for (const suffix of ["news", "press release"] as const) {
		queries.push({
			options: {
				endDate: windowEnd,
				excludeDomains,
				maxResults: MAX_RESULTS_PER_QUERY,
				searchDepth: "advanced",
				startDate: windowStart,
				topic: "news",
			},
			query: `${name} ${suffix}`,
		});
	}

	for (const suffix of [
		"podcast interview",
		"blog post",
		"newsletter",
		"trade publication",
		"social media",
	] as const) {
		queries.push({
			options: {
				excludeDomains,
				maxResults: MAX_RESULTS_PER_QUERY,
				searchDepth: "advanced",
				timeRange: "year",
				topic: "general",
			},
			query: `${name} ${suffix}`,
		});
	}

	const slices = [
		{ end: addMonths(windowStart, 12), start: windowStart },
		{ end: addMonths(windowStart, 24), start: addMonths(windowStart, 12) },
		{ end: windowEnd, start: addMonths(windowStart, 24) },
	];
	for (const slice of slices) {
		for (const type of ["news", "press release"] as const) {
			queries.push({
				options: {
					endDate: slice.end,
					excludeDomains,
					maxResults: MAX_RESULTS_PER_QUERY,
					searchDepth: "advanced",
					startDate: slice.start,
					topic: "news",
				},
				query: `${name} ${type}`,
			});
		}
	}

	for (const angle of [
		"funding",
		"acquisition",
		"leadership interview",
		"partnership",
		"lawsuit OR controversy",
	] as const) {
		queries.push({
			options: {
				excludeDomains,
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
