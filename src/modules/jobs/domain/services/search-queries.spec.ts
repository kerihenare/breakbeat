import type { ResolvedIdentity } from "../resolved-identity";
import {
	buildBackstopQueries,
	buildEscalationQueries,
	buildSearchQueries,
	TAVILY_THIN_THRESHOLD,
} from "./search-queries";

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

	it("excludes own domains, aggregators, and negative-match domains (deduped)", () => {
		const ex = queries[0].options.excludeDomains;
		expect(ex).toContain("acme.com");
		expect(ex).toContain("reddit.com"); // aggregator blocklist
		expect(ex).toContain("acmefoods.com"); // negative match
		expect(new Set(ex).size).toBe(ex.length); // deduped
	});

	it("does NOT exclude shared social-platform hosts from a handle", () => {
		// Excluding x.com wholesale would drop third-party coverage on the
		// platform; the own profile is removed later by matchesHandlePrefix.
		const ex = queries[0].options.excludeDomains;
		expect(ex).not.toContain("x.com");
	});

	it("excludes a dedicated (subdomain) handle host wholesale", () => {
		const ex = buildSearchQueries({
			...identity,
			handles: ["https://acme.substack.com"],
		})[0].options.excludeDomains;
		expect(ex).toContain("acme.substack.com");
	});
});

describe("backstop queries", () => {
	const identity: ResolvedIdentity = {
		domains: ["acme.com"],
		handles: [],
		name: "Acme",
		negativeMatches: [],
		provenance: "url_provided" as const,
		window: { end: "2026-06-08", start: "2023-06-08" },
	};
	it("builds 1-3 broad NL queries naming the company", () => {
		const qs = buildBackstopQueries(identity);
		expect(qs.length).toBeGreaterThanOrEqual(1);
		expect(qs.length).toBeLessThanOrEqual(3);
		expect(qs.some((q) => q.includes("Acme"))).toBe(true);
	});
	it("escalation queries reuse the full angle set as plain strings", () => {
		expect(buildEscalationQueries(identity).length).toBeGreaterThan(5);
	});
	it("exposes a numeric thin threshold", () => {
		expect(typeof TAVILY_THIN_THRESHOLD).toBe("number");
	});
});
