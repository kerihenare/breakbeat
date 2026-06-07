import type { ResolvedIdentity } from "../resolved-identity";
import { buildSearchQueries } from "./search-queries";

const identity: ResolvedIdentity = {
	domains: ["acme.com"],
	handles: ["https://x.com/acme"],
	name: "Acme",
	negativeMatches: ["acmefoods.com"],
	provenance: "url_provided",
	window: { end: "2026-06-08", start: "2023-06-08" },
};

describe("buildSearchQueries", () => {
	const queries = buildSearchQueries(identity);

	it("produces exactly 18 queries", () => {
		expect(queries).toHaveLength(18);
	});

	it("uses news topic with date bounds for news/press-release queries", () => {
		const news = queries.filter((q) => q.options.topic === "news");
		// 2 per-type + 6 time-sliced = 8 news-topic queries
		expect(news).toHaveLength(8);
		for (const q of news) {
			expect(q.options.startDate).toBeDefined();
			expect(q.options.endDate).toBeDefined();
		}
	});

	it("time-slices tile the window start→end across three 12-month slices", () => {
		const sliced = queries.filter(
			(q) => q.options.topic === "news" && q.query === "Acme news",
		);
		// 1 per-type "Acme news" + 3 sliced "Acme news" = 4
		const starts = sliced.map((q) => q.options.startDate).sort();
		expect(starts).toContain("2023-06-08");
		expect(starts).toContain("2024-06-08");
		expect(starts).toContain("2025-06-08");
	});

	it("excludes own domains, own-social hosts, aggregators, and negative-match domains (deduped)", () => {
		const ex = queries[0].options.excludeDomains;
		expect(ex).toContain("acme.com");
		expect(ex).toContain("x.com"); // from the social handle
		expect(ex).toContain("reddit.com"); // aggregator blocklist
		expect(ex).toContain("acmefoods.com"); // negative match
		expect(new Set(ex).size).toBe(ex.length); // deduped
	});
});
