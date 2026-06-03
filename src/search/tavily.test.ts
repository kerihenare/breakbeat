import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
	AGGREGATOR_BLOCKLIST,
	buildQueries,
	MAX_QUERIES,
	type ResolvedIdentity,
} from "./tavily.ts";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const BASE_IDENTITY: ResolvedIdentity = {
	domains: ["acme.com"],
	handles: ["https://linkedin.com/company/acme", "https://x.com/acmecorp"],
	name: "Acme",
	windowEnd: "2026-06-03",
	windowStart: "2023-06-03",
};

const WINDOW_START = "2023-06-03";
const WINDOW_END = "2026-06-03";

// ─── buildQueries: total count ────────────────────────────────────────────────

describe("buildQueries", () => {
	it("generates exactly 18 queries", () => {
		const queries = buildQueries(BASE_IDENTITY, WINDOW_START, WINDOW_END);
		assert.equal(queries.length, 18);
	});

	it("total is within MAX_QUERIES cap (20)", () => {
		const queries = buildQueries(BASE_IDENTITY, WINDOW_START, WINDOW_END);
		assert.ok(
			queries.length <= MAX_QUERIES,
			`expected ≤ ${MAX_QUERIES} queries, got ${queries.length}`,
		);
	});

	// ─── Group 1: 7 per-content-type queries ──────────────────────────────────

	it("generates 7 per-content-type queries", () => {
		const queries = buildQueries(BASE_IDENTITY, WINDOW_START, WINDOW_END);

		// News and press release type-queries use the FULL window bounds.
		// The sliced queries use sub-window bounds, so we identify type-queries
		// by checking for topic="news" + full window bounds, OR topic="general".
		const newsTypeQuery = queries.find(
			(q) =>
				q.query === `${BASE_IDENTITY.name} news` &&
				q.options.startDate === WINDOW_START &&
				q.options.endDate === WINDOW_END,
		);
		const prTypeQuery = queries.find(
			(q) =>
				q.query === `${BASE_IDENTITY.name} press release` &&
				q.options.startDate === WINDOW_START &&
				q.options.endDate === WINDOW_END,
		);
		const generalTypeQueries = queries.filter(
			(q) =>
				[
					`${BASE_IDENTITY.name} podcast interview`,
					`${BASE_IDENTITY.name} blog post`,
					`${BASE_IDENTITY.name} newsletter`,
					`${BASE_IDENTITY.name} trade publication`,
					`${BASE_IDENTITY.name} social media`,
				].includes(q.query) && q.options.topic === "general",
		);

		assert.ok(
			newsTypeQuery,
			"news type-query should exist with full window bounds",
		);
		assert.ok(
			prTypeQuery,
			"press release type-query should exist with full window bounds",
		);
		assert.equal(
			generalTypeQueries.length,
			5,
			"should have 5 general type queries",
		);
		// 2 news-type + 5 general = 7 total
		assert.equal(
			2 + generalTypeQueries.length,
			7,
			"should have 7 content-type queries total",
		);
	});

	it("news and press release type-queries carry topic: news and date bounds", () => {
		const queries = buildQueries(BASE_IDENTITY, WINDOW_START, WINDOW_END);

		const newsQuery = queries.find(
			(q) => q.query === `${BASE_IDENTITY.name} news`,
		);
		const prQuery = queries.find(
			(q) => q.query === `${BASE_IDENTITY.name} press release`,
		);

		assert.ok(newsQuery, "news type-query should exist");
		assert.equal(newsQuery!.options.topic, "news");
		assert.equal(newsQuery!.options.startDate, WINDOW_START);
		assert.equal(newsQuery!.options.endDate, WINDOW_END);
		assert.equal(newsQuery!.options.timeRange, undefined);

		assert.ok(prQuery, "press release type-query should exist");
		assert.equal(prQuery!.options.topic, "news");
		assert.equal(prQuery!.options.startDate, WINDOW_START);
		assert.equal(prQuery!.options.endDate, WINDOW_END);
		assert.equal(prQuery!.options.timeRange, undefined);
	});

	it("dateless type-queries carry topic: general and timeRange (no date bounds)", () => {
		const queries = buildQueries(BASE_IDENTITY, WINDOW_START, WINDOW_END);

		const datelessSuffixes = [
			"podcast interview",
			"blog post",
			"newsletter",
			"trade publication",
			"social media",
		];

		for (const suffix of datelessSuffixes) {
			const q = queries.find(
				(q) => q.query === `${BASE_IDENTITY.name} ${suffix}`,
			);
			assert.ok(q, `query for "${suffix}" should exist`);
			assert.equal(
				q!.options.topic,
				"general",
				`"${suffix}" should use topic: general`,
			);
			assert.ok(q!.options.timeRange, `"${suffix}" should have timeRange`);
			assert.equal(
				q!.options.startDate,
				undefined,
				`"${suffix}" should not have startDate`,
			);
			assert.equal(
				q!.options.endDate,
				undefined,
				`"${suffix}" should not have endDate`,
			);
		}
	});

	// ─── Group 2: 6 time-sliced queries ───────────────────────────────────────

	it("generates exactly 6 time-sliced queries", () => {
		const queries = buildQueries(BASE_IDENTITY, WINDOW_START, WINDOW_END);

		// The 6 sliced queries are additional (beyond the 7 type-queries),
		// so find them by looking for news/press-release queries that have
		// date bounds OTHER than the full window bounds (or matching slices)
		const sliceBoundaries = [
			{ end: "2024-06-03", start: WINDOW_START },
			{ end: "2025-06-03", start: "2024-06-03" },
			{ end: WINDOW_END, start: "2025-06-03" },
		];

		let slicedCount = 0;
		for (const slice of sliceBoundaries) {
			for (const suffix of ["news", "press release"]) {
				const matching = queries.filter(
					(q) =>
						q.query === `${BASE_IDENTITY.name} ${suffix}` &&
						q.options.startDate === slice.start &&
						q.options.endDate === slice.end,
				);
				slicedCount += matching.length;
			}
		}

		assert.equal(
			slicedCount,
			6,
			"should have 6 time-sliced queries (2 types × 3 slices)",
		);
	});

	it("time-sliced queries tile the full 36-month window exactly", () => {
		const queries = buildQueries(BASE_IDENTITY, WINDOW_START, WINDOW_END);

		// Expected slices: [windowStart→+12m], [+12m→+24m], [+24m→windowEnd]
		const expectedSlices = [
			{ end: "2024-06-03", start: "2023-06-03" },
			{ end: "2025-06-03", start: "2024-06-03" },
			{ end: "2026-06-03", start: "2025-06-03" },
		];

		for (const slice of expectedSlices) {
			for (const suffix of ["news", "press release"]) {
				const found = queries.some(
					(q) =>
						q.query === `${BASE_IDENTITY.name} ${suffix}` &&
						q.options.startDate === slice.start &&
						q.options.endDate === slice.end &&
						q.options.topic === "news",
				);
				assert.ok(
					found,
					`missing sliced query for "${suffix}" with ${slice.start} → ${slice.end}`,
				);
			}
		}
	});

	it("all time-sliced queries carry topic: news", () => {
		const queries = buildQueries(BASE_IDENTITY, WINDOW_START, WINDOW_END);

		const sliceBoundaries = [
			{ end: "2024-06-03", start: WINDOW_START },
			{ end: "2025-06-03", start: "2024-06-03" },
			{ end: WINDOW_END, start: "2025-06-03" },
		];

		for (const slice of sliceBoundaries) {
			for (const suffix of ["news", "press release"]) {
				const q = queries.find(
					(q) =>
						q.query === `${BASE_IDENTITY.name} ${suffix}` &&
						q.options.startDate === slice.start &&
						q.options.endDate === slice.end,
				);
				assert.ok(
					q,
					`slice query ${suffix} ${slice.start} → ${slice.end} should exist`,
				);
				assert.equal(
					q!.options.topic,
					"news",
					`slice query "${suffix}" should use topic: news`,
				);
			}
		}
	});

	// ─── Group 3: 5 angle queries ─────────────────────────────────────────────

	it("generates exactly 5 angle queries", () => {
		const queries = buildQueries(BASE_IDENTITY, WINDOW_START, WINDOW_END);

		const angleQueries = queries.filter((q) =>
			[
				`${BASE_IDENTITY.name} funding`,
				`${BASE_IDENTITY.name} acquisition`,
				`${BASE_IDENTITY.name} leadership interview`,
				`${BASE_IDENTITY.name} partnership`,
				`${BASE_IDENTITY.name} lawsuit OR controversy`,
			].includes(q.query),
		);

		assert.equal(angleQueries.length, 5, "should have 5 angle queries");
	});

	it("all angle queries carry topic: general and timeRange (no date bounds)", () => {
		const queries = buildQueries(BASE_IDENTITY, WINDOW_START, WINDOW_END);

		const angles = [
			"funding",
			"acquisition",
			"leadership interview",
			"partnership",
			"lawsuit OR controversy",
		];

		for (const angle of angles) {
			const q = queries.find(
				(q) => q.query === `${BASE_IDENTITY.name} ${angle}`,
			);
			assert.ok(q, `angle query "${angle}" should exist`);
			assert.equal(
				q!.options.topic,
				"general",
				`angle "${angle}" should use topic: general`,
			);
			assert.ok(q!.options.timeRange, `angle "${angle}" should have timeRange`);
			assert.equal(
				q!.options.startDate,
				undefined,
				`angle "${angle}" should not have startDate`,
			);
			assert.equal(
				q!.options.endDate,
				undefined,
				`angle "${angle}" should not have endDate`,
			);
		}
	});

	// ─── excludeDomains on every query ────────────────────────────────────────

	it("every query includes own domains in excludeDomains", () => {
		const queries = buildQueries(BASE_IDENTITY, WINDOW_START, WINDOW_END);

		for (const q of queries) {
			const excluded = q.options.excludeDomains ?? [];
			for (const domain of BASE_IDENTITY.domains) {
				assert.ok(
					excluded.includes(domain),
					`own domain "${domain}" should be in excludeDomains of query "${q.query}"`,
				);
			}
		}
	});

	it("every query includes aggregator blocklist in excludeDomains", () => {
		const queries = buildQueries(BASE_IDENTITY, WINDOW_START, WINDOW_END);

		for (const q of queries) {
			const excluded = q.options.excludeDomains ?? [];
			for (const agg of AGGREGATOR_BLOCKLIST) {
				assert.ok(
					excluded.includes(agg),
					`aggregator "${agg}" should be in excludeDomains of query "${q.query}"`,
				);
			}
		}
	});

	it("every query excludes social handle domains", () => {
		const queries = buildQueries(BASE_IDENTITY, WINDOW_START, WINDOW_END);

		// handles are: linkedin.com/company/acme and x.com/acmecorp
		// extracted domains: linkedin.com, x.com
		for (const q of queries) {
			const excluded = q.options.excludeDomains ?? [];
			assert.ok(
				excluded.includes("linkedin.com"),
				`linkedin.com should be excluded in "${q.query}"`,
			);
			assert.ok(
				excluded.includes("x.com"),
				`x.com should be excluded in "${q.query}"`,
			);
		}
	});

	// ─── searchDepth and maxResults on every query ────────────────────────────

	it("every query uses searchDepth: advanced", () => {
		const queries = buildQueries(BASE_IDENTITY, WINDOW_START, WINDOW_END);
		for (const q of queries) {
			assert.equal(
				q.options.searchDepth,
				"advanced",
				`query "${q.query}" should use searchDepth: advanced`,
			);
		}
	});

	it("every query uses maxResults: 20", () => {
		const queries = buildQueries(BASE_IDENTITY, WINDOW_START, WINDOW_END);
		for (const q of queries) {
			assert.equal(
				q.options.maxResults,
				20,
				`query "${q.query}" should use maxResults: 20`,
			);
		}
	});

	// ─── Edge cases ───────────────────────────────────────────────────────────

	it("works with zero own domains and no handles", () => {
		const identity: ResolvedIdentity = {
			domains: [],
			handles: [],
			name: "Globex",
			windowEnd: "2026-06-03",
			windowStart: "2023-06-03",
		};
		const queries = buildQueries(identity, WINDOW_START, WINDOW_END);
		assert.equal(queries.length, 18);

		// Only aggregator blocklist entries should be excluded
		for (const q of queries) {
			const excluded = q.options.excludeDomains ?? [];
			for (const agg of AGGREGATOR_BLOCKLIST) {
				assert.ok(
					excluded.includes(agg),
					`aggregator "${agg}" missing from "${q.query}"`,
				);
			}
		}
	});

	it("does not include Medium in AGGREGATOR_BLOCKLIST", () => {
		assert.ok(
			!AGGREGATOR_BLOCKLIST.includes("medium.com"),
			"Medium should NOT be in the aggregator blocklist",
		);
	});

	it("slice boundaries are YYYY-MM-DD strings", () => {
		const queries = buildQueries(BASE_IDENTITY, WINDOW_START, WINDOW_END);
		const datePattern = /^\d{4}-\d{2}-\d{2}$/;

		for (const q of queries) {
			if (q.options.startDate !== undefined) {
				assert.match(
					q.options.startDate,
					datePattern,
					`startDate "${q.options.startDate}" in "${q.query}" is not YYYY-MM-DD`,
				);
			}
			if (q.options.endDate !== undefined) {
				assert.match(
					q.options.endDate,
					datePattern,
					`endDate "${q.options.endDate}" in "${q.query}" is not YYYY-MM-DD`,
				);
			}
		}
	});
});
