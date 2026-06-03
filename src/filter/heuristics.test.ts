import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ResolvedIdentity } from "../search/tavily.ts";
import {
	ECOMMERCE_PATH_SEGMENTS,
	ECOMMERCE_TITLE_PATTERNS,
	heuristicExclusion,
	REVIEW_DOMAINS,
} from "./heuristics.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeResult(overrides: {
	url?: string;
	title?: string;
	source_domain?: string;
	published_date?: string | null;
}) {
	return {
		confidence: null,
		content_type: null,
		exclusion_code: null,
		exclusion_detail: null,
		id: 1,
		published_date:
			overrides.published_date !== undefined
				? overrides.published_date
				: "2025-01-01",
		source_domain: overrides.source_domain ?? "example.com",
		status: "included" as const,
		title: overrides.title ?? "Some Article",
		url: overrides.url ?? "https://example.com/article",
	};
}

function makeIdentity(overrides: {
	name?: string;
	domains?: string[];
	handles?: string[];
}): ResolvedIdentity {
	return {
		domains: overrides.domains ?? [],
		handles: overrides.handles ?? [],
		name: overrides.name ?? "Acme Corp",
		windowEnd: "2026-06-01",
		windowStart: "2023-06-01",
	};
}

const WINDOW_START = new Date("2023-06-01");

// ─── Exported constants ───────────────────────────────────────────────────────

describe("exported constants", () => {
	it("REVIEW_DOMAINS has 7 entries", () => {
		assert.equal(REVIEW_DOMAINS.length, 7);
	});

	it("ECOMMERCE_PATH_SEGMENTS has 9 entries", () => {
		assert.equal(ECOMMERCE_PATH_SEGMENTS.length, 9);
	});

	it("ECOMMERCE_TITLE_PATTERNS has 3 entries", () => {
		assert.equal(ECOMMERCE_TITLE_PATTERNS.length, 3);
	});
});

// ─── Own channel ─────────────────────────────────────────────────────────────

describe("own_channel — domain match", () => {
	it("exact domain match → own_channel", () => {
		const identity = makeIdentity({ domains: ["acme.com"] });
		const result = makeResult({
			source_domain: "acme.com",
			url: "https://acme.com/about",
		});
		const exc = heuristicExclusion(result, identity, WINDOW_START);
		assert.equal(exc?.code, "own_channel");
	});

	it("subdomain match → own_channel", () => {
		const identity = makeIdentity({ domains: ["acme.com"] });
		const result = makeResult({
			source_domain: "blog.acme.com",
			url: "https://blog.acme.com/post",
		});
		const exc = heuristicExclusion(result, identity, WINDOW_START);
		assert.equal(exc?.code, "own_channel");
	});

	it("unrelated domain → passes", () => {
		const identity = makeIdentity({ domains: ["acme.com"] });
		const result = makeResult({
			source_domain: "techcrunch.com",
			url: "https://techcrunch.com/acme",
		});
		const exc = heuristicExclusion(result, identity, WINDOW_START);
		assert.equal(exc, null);
	});

	it("domain that merely contains own domain as substring → passes", () => {
		const identity = makeIdentity({ domains: ["acme.com"] });
		const result = makeResult({
			source_domain: "notacme.com",
			url: "https://notacme.com/post",
		});
		const exc = heuristicExclusion(result, identity, WINDOW_START);
		assert.equal(exc, null);
	});
});

describe("own_channel — social handle prefix match", () => {
	it("own linkedin company page URL → own_channel", () => {
		const identity = makeIdentity({
			handles: ["https://linkedin.com/company/acme"],
		});
		const result = makeResult({
			source_domain: "linkedin.com",
			url: "https://linkedin.com/company/acme/posts/123",
		});
		const exc = heuristicExclusion(result, identity, WINDOW_START);
		assert.equal(exc?.code, "own_channel");
	});

	it("journalist article on linkedin (different path) → passes", () => {
		const identity = makeIdentity({
			handles: ["https://linkedin.com/company/acme"],
		});
		const result = makeResult({
			source_domain: "linkedin.com",
			url: "https://linkedin.com/pulse/great-article-jane-doe",
		});
		const exc = heuristicExclusion(result, identity, WINDOW_START);
		assert.equal(exc, null);
	});

	it("own x.com handle → own_channel", () => {
		const identity = makeIdentity({ handles: ["https://x.com/acmecorp"] });
		const result = makeResult({
			source_domain: "x.com",
			url: "https://x.com/acmecorp/status/123456",
		});
		const exc = heuristicExclusion(result, identity, WINDOW_START);
		assert.equal(exc?.code, "own_channel");
	});

	it("different x.com user → passes", () => {
		const identity = makeIdentity({ handles: ["https://x.com/acmecorp"] });
		const result = makeResult({
			source_domain: "x.com",
			url: "https://x.com/journalistjane/status/999",
		});
		const exc = heuristicExclusion(result, identity, WINDOW_START);
		assert.equal(exc, null);
	});

	it("partial username segment match → passes (acmecorp vs acme)", () => {
		const identity = makeIdentity({ handles: ["https://x.com/acme"] });
		const result = makeResult({
			source_domain: "x.com",
			url: "https://x.com/acmecorp/status/123",
		});
		const exc = heuristicExclusion(result, identity, WINDOW_START);
		assert.equal(exc, null);
	});
});

// ─── Aggregator ───────────────────────────────────────────────────────────────

describe("aggregator", () => {
	it("reddit.com → aggregator", () => {
		const identity = makeIdentity({});
		const result = makeResult({
			source_domain: "reddit.com",
			url: "https://reddit.com/r/tech/comments/abc",
		});
		const exc = heuristicExclusion(result, identity, WINDOW_START);
		assert.equal(exc?.code, "aggregator");
	});

	it("news.ycombinator.com → aggregator", () => {
		const identity = makeIdentity({});
		const result = makeResult({
			source_domain: "news.ycombinator.com",
			url: "https://news.ycombinator.com/item?id=123",
		});
		const exc = heuristicExclusion(result, identity, WINDOW_START);
		assert.equal(exc?.code, "aggregator");
	});

	it("subdomain of aggregator → aggregator", () => {
		const identity = makeIdentity({});
		const result = makeResult({
			source_domain: "old.reddit.com",
			url: "https://old.reddit.com/r/tech",
		});
		const exc = heuristicExclusion(result, identity, WINDOW_START);
		assert.equal(exc?.code, "aggregator");
	});

	it("medium.com → passes (not an aggregator)", () => {
		const identity = makeIdentity({});
		const result = makeResult({
			source_domain: "medium.com",
			url: "https://medium.com/@author/article",
		});
		const exc = heuristicExclusion(result, identity, WINDOW_START);
		assert.equal(exc, null);
	});

	it("unrelated domain → passes", () => {
		const identity = makeIdentity({});
		const result = makeResult({
			source_domain: "techcrunch.com",
			url: "https://techcrunch.com/story",
		});
		const exc = heuristicExclusion(result, identity, WINDOW_START);
		assert.equal(exc, null);
	});
});

// ─── Ecommerce / review ───────────────────────────────────────────────────────

describe("ecommerce_review — review site domains", () => {
	for (const domain of [
		"g2.com",
		"capterra.com",
		"trustpilot.com",
		"trustradius.com",
		"getapp.com",
		"softwareadvice.com",
		"producthunt.com",
	]) {
		it(`${domain} → ecommerce_review`, () => {
			const identity = makeIdentity({});
			const result = makeResult({
				source_domain: domain,
				url: `https://${domain}/reviews/acme`,
			});
			const exc = heuristicExclusion(result, identity, WINDOW_START);
			assert.equal(exc?.code, "ecommerce_review");
		});
	}
});

describe("ecommerce_review — path segments", () => {
	const segments = [
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
	for (const seg of segments) {
		it(`path ${seg} → ecommerce_review`, () => {
			const identity = makeIdentity({});
			const result = makeResult({
				source_domain: "somesite.com",
				url: `https://somesite.com${seg}acme`,
			});
			const exc = heuristicExclusion(result, identity, WINDOW_START);
			assert.equal(exc?.code, "ecommerce_review");
		});
	}
});

describe("ecommerce_review — title patterns", () => {
	it("'Best CRM Alternatives for 2025' → ecommerce_review", () => {
		const identity = makeIdentity({});
		const result = makeResult({
			source_domain: "somesite.com",
			title: "Best CRM Alternatives for 2025",
			url: "https://somesite.com/article",
		});
		const exc = heuristicExclusion(result, identity, WINDOW_START);
		assert.equal(exc?.code, "ecommerce_review");
	});

	it("'Best project management tools in 2024' → ecommerce_review", () => {
		const identity = makeIdentity({});
		const result = makeResult({
			source_domain: "somesite.com",
			title: "Best project management tools in 2024",
			url: "https://somesite.com/article",
		});
		const exc = heuristicExclusion(result, identity, WINDOW_START);
		assert.equal(exc?.code, "ecommerce_review");
	});

	it("'Review of Acme's latest release' → ecommerce_review", () => {
		const identity = makeIdentity({});
		const result = makeResult({
			source_domain: "somesite.com",
			title: "Review of Acme's latest release",
			url: "https://somesite.com/article",
		});
		const exc = heuristicExclusion(result, identity, WINDOW_START);
		assert.equal(exc?.code, "ecommerce_review");
	});

	it("'Comparison of top CRMs' → ecommerce_review", () => {
		const identity = makeIdentity({});
		const result = makeResult({
			source_domain: "somesite.com",
			title: "Comparison of top CRMs",
			url: "https://somesite.com/article",
		});
		const exc = heuristicExclusion(result, identity, WINDOW_START);
		assert.equal(exc?.code, "ecommerce_review");
	});

	it("'Top 10 CRM tools' → ecommerce_review (anchored ^top \\d+)", () => {
		const identity = makeIdentity({});
		const result = makeResult({
			source_domain: "somesite.com",
			title: "Top 10 CRM tools",
			url: "https://somesite.com/article",
		});
		const exc = heuristicExclusion(result, identity, WINDOW_START);
		assert.equal(exc?.code, "ecommerce_review");
	});

	it("'Top 10 fintech stories' mid-title context → passes (anchored ^top \\d+)", () => {
		// Note: even starting with "Top 10" this gets excluded.
		// The test should verify that "Top 10 fintech stories" is caught because it IS ^top \d+
		// The real "mid-title" test is that a title NOT starting with "Top N" passes.
		const identity = makeIdentity({});
		const result = makeResult({
			source_domain: "somesite.com",
			title: "We reviewed the Top 10 fintech stories of 2024",
			url: "https://somesite.com/article",
		});
		const exc = heuristicExclusion(result, identity, WINDOW_START);
		// Does NOT start with "Top 10" — should pass
		assert.equal(exc, null);
	});

	it("'Acme vs the regulators' → passes (vs is path-only)", () => {
		const identity = makeIdentity({});
		const result = makeResult({
			source_domain: "somesite.com",
			title: "Acme vs the regulators",
			url: "https://somesite.com/article",
		});
		const exc = heuristicExclusion(result, identity, WINDOW_START);
		assert.equal(exc, null);
	});

	it("'How Acme competes in the market' → passes", () => {
		const identity = makeIdentity({});
		const result = makeResult({
			source_domain: "somesite.com",
			title: "How Acme competes in the market",
			url: "https://somesite.com/article",
		});
		const exc = heuristicExclusion(result, identity, WINDOW_START);
		assert.equal(exc, null);
	});
});

// ─── Out of window ────────────────────────────────────────────────────────────

describe("out_of_window", () => {
	it("date before windowStart → out_of_window", () => {
		const identity = makeIdentity({});
		const result = makeResult({ published_date: "2022-01-15" });
		const exc = heuristicExclusion(result, identity, new Date("2023-06-01"));
		assert.equal(exc?.code, "out_of_window");
	});

	it("date equal to windowStart → passes (on the boundary)", () => {
		const identity = makeIdentity({});
		const result = makeResult({ published_date: "2023-06-01" });
		const exc = heuristicExclusion(result, identity, new Date("2023-06-01"));
		assert.equal(exc, null);
	});

	it("date after windowStart → passes", () => {
		const identity = makeIdentity({});
		const result = makeResult({ published_date: "2024-03-15" });
		const exc = heuristicExclusion(result, identity, new Date("2023-06-01"));
		assert.equal(exc, null);
	});

	it("null published_date → passes (dateless results kept)", () => {
		const identity = makeIdentity({});
		const result = makeResult({ published_date: null });
		const exc = heuristicExclusion(result, identity, new Date("2023-06-01"));
		assert.equal(exc, null);
	});
});

// ─── Rule ordering ────────────────────────────────────────────────────────────

describe("rule ordering", () => {
	it("own_channel wins over aggregator when source is both", () => {
		// Imagine a hypothetical own aggregator domain — own_channel check runs first
		const identity = makeIdentity({ domains: ["reddit.com"] });
		const result = makeResult({
			source_domain: "reddit.com",
			url: "https://reddit.com/r/acme",
		});
		const exc = heuristicExclusion(result, identity, WINDOW_START);
		assert.equal(exc?.code, "own_channel");
	});
});
