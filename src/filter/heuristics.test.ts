import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createDb } from "../db.ts";
import type { ResolvedIdentity } from "../search/tavily.ts";
import {
	collapse,
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

// ─── collapse() ──────────────────────────────────────────────────────────────

// Helper: set up a company + job, return { db, jobId }
function setupCollapseDb() {
	const db = createDb(":memory:");
	db.prepare("INSERT INTO companies (name) VALUES (?)").run("Acme Corp");
	const company = db
		.prepare("SELECT id FROM companies WHERE name = ?")
		.get("Acme Corp") as { id: number };
	db.prepare("INSERT INTO jobs (company_id) VALUES (?)").run(company.id);
	const job = db
		.prepare("SELECT id FROM jobs WHERE company_id = ?")
		.get(company.id) as { id: number };
	return { db, jobId: job.id };
}

// Insert a result and return its auto-assigned id
function insertResult(
	db: ReturnType<typeof createDb>,
	jobId: number,
	opts: {
		title: string;
		url: string;
		published_date?: string | null;
		status?: "included" | "excluded";
		exclusion_code?: string | null;
	},
): number {
	const normalizedUrl = opts.url.replace(/^https?:\/\/(www\.)?/, "");
	db.prepare(
		`INSERT INTO results (job_id, url, normalized_url, title, source_domain, published_date, status, exclusion_code)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
	).run(
		jobId,
		opts.url,
		normalizedUrl,
		opts.title,
		"example.com",
		opts.published_date ?? null,
		opts.status ?? "included",
		opts.exclusion_code ?? null,
	);
	const row = db
		.prepare("SELECT id FROM results WHERE job_id = ? AND url = ?")
		.get(jobId, opts.url) as { id: number };
	return row.id;
}

type ResultRow = {
	id: number;
	status: string;
	exclusion_code: string | null;
	exclusion_detail: string | null;
};

function getResult(db: ReturnType<typeof createDb>, id: number): ResultRow {
	return db
		.prepare(
			"SELECT id, status, exclusion_code, exclusion_detail FROM results WHERE id = ?",
		)
		.get(id) as ResultRow;
}

// A title long enough to pass the ≥25-char guard after normalization
const LONG_TITLE = "Acme Corp raises fifty million dollars in Series B round";

describe("collapse — syndicated pair collapses", () => {
	it("same normalized title, dates 3 days apart → earliest wins, loser is excluded duplicate", () => {
		const { db, jobId } = setupCollapseDb();
		const id1 = insertResult(db, jobId, {
			published_date: "2025-01-01",
			title: `${LONG_TITLE} | TechCrunch`,
			url: "https://techcrunch.com/acme-series-b",
		});
		const id2 = insertResult(db, jobId, {
			published_date: "2025-01-04",
			title: `${LONG_TITLE} - Yahoo Finance`,
			url: "https://finance.yahoo.com/acme-series-b",
		});
		collapse(db, jobId);
		const r1 = getResult(db, id1);
		const r2 = getResult(db, id2);
		// id1 is earlier → winner
		assert.equal(r1.status, "included");
		assert.equal(r1.exclusion_code, null);
		// id2 is later → loser
		assert.equal(r2.status, "excluded");
		assert.equal(r2.exclusion_code, "duplicate");
		assert.equal(r2.exclusion_detail, `of #${id1}`);
		db.close();
	});
});

describe("collapse — short titles never collapse", () => {
	it("normalized title < 25 chars is skipped (kept included even if matching)", () => {
		const { db, jobId } = setupCollapseDb();
		// Title that normalizes to fewer than 25 characters (stripped outlet suffix)
		const shortTitle = "Acme news | TechCrunch"; // "acme news" = 9 chars after strip
		const id1 = insertResult(db, jobId, {
			published_date: "2025-01-01",
			title: shortTitle,
			url: "https://techcrunch.com/acme-short-1",
		});
		const id2 = insertResult(db, jobId, {
			published_date: "2025-01-02",
			title: shortTitle,
			url: "https://reuters.com/acme-short-2",
		});
		collapse(db, jobId);
		// Both should stay included because normalized title is too short
		assert.equal(getResult(db, id1).status, "included");
		assert.equal(getResult(db, id2).status, "included");
		db.close();
	});
});

describe("collapse — same title 18 months apart does NOT collapse", () => {
	it("two stories 18 months apart → different clusters → both included", () => {
		const { db, jobId } = setupCollapseDb();
		const id1 = insertResult(db, jobId, {
			published_date: "2024-01-01",
			title: LONG_TITLE,
			url: "https://techcrunch.com/acme-story-early",
		});
		const id2 = insertResult(db, jobId, {
			published_date: "2025-07-01",
			title: LONG_TITLE,
			url: "https://techcrunch.com/acme-story-late",
		});
		collapse(db, jobId);
		assert.equal(getResult(db, id1).status, "included");
		assert.equal(getResult(db, id2).status, "included");
		db.close();
	});
});

describe("collapse — anchor-on-earliest, no chaining drift", () => {
	it("day0/day10/day20 → cluster {day0,day10} + singleton {day20}", () => {
		const { db, jobId } = setupCollapseDb();
		const id0 = insertResult(db, jobId, {
			published_date: "2025-01-01",
			title: LONG_TITLE,
			url: "https://source-a.com/acme-chain-0",
		});
		const id10 = insertResult(db, jobId, {
			published_date: "2025-01-11",
			title: LONG_TITLE,
			url: "https://source-b.com/acme-chain-10",
		});
		const id20 = insertResult(db, jobId, {
			published_date: "2025-01-21",
			title: LONG_TITLE,
			url: "https://source-c.com/acme-chain-20",
		});
		collapse(db, jobId);
		// day0 is anchor-winner of cluster 1
		assert.equal(getResult(db, id0).status, "included");
		// day10 is within 14 days of day0 → loser in cluster 1
		assert.equal(getResult(db, id10).status, "excluded");
		assert.equal(getResult(db, id10).exclusion_code, "duplicate");
		assert.equal(getResult(db, id10).exclusion_detail, `of #${id0}`);
		// day20 is 20 days from day0 → new cluster → included
		assert.equal(getResult(db, id20).status, "included");
		db.close();
	});
});

describe("collapse — already-excluded result never competes or wins", () => {
	it("pre-excluded result is not in collapse pool; included copy stays included", () => {
		const { db, jobId } = setupCollapseDb();
		// Insert an already-excluded result (earlier date) — must not win
		const idExcluded = insertResult(db, jobId, {
			exclusion_code: "aggregator",
			published_date: "2024-12-31",
			status: "excluded",
			title: LONG_TITLE,
			url: "https://aggregator.com/acme-excluded",
		});
		// Insert an included result with a later date
		const idIncluded = insertResult(db, jobId, {
			published_date: "2025-01-01",
			title: LONG_TITLE,
			url: "https://techcrunch.com/acme-included",
		});
		collapse(db, jobId);
		// Excluded one stays excluded as aggregator (not touched by collapse)
		const excRow = getResult(db, idExcluded);
		assert.equal(excRow.status, "excluded");
		assert.equal(excRow.exclusion_code, "aggregator");
		// Included one stays included (no peer to collapse with)
		assert.equal(getResult(db, idIncluded).status, "included");
		db.close();
	});
});

describe("collapse — unknown-dated copy joins single-cluster group", () => {
	it("one dated cluster + one undated result → undated excluded as duplicate of winner", () => {
		const { db, jobId } = setupCollapseDb();
		const idDated = insertResult(db, jobId, {
			published_date: "2025-01-01",
			title: LONG_TITLE,
			url: "https://techcrunch.com/acme-dated",
		});
		const idUndated = insertResult(db, jobId, {
			published_date: null,
			title: LONG_TITLE,
			url: "https://somesite.com/acme-undated",
		});
		collapse(db, jobId);
		// dated is winner (single cluster)
		assert.equal(getResult(db, idDated).status, "included");
		// undated joins → excluded as duplicate of winner
		const undatedRow = getResult(db, idUndated);
		assert.equal(undatedRow.status, "excluded");
		assert.equal(undatedRow.exclusion_code, "duplicate");
		assert.equal(undatedRow.exclusion_detail, `of #${idDated}`);
		db.close();
	});
});

describe("collapse — unknown-dated stays included with multiple clusters", () => {
	it("two dated clusters + undated → undated stays included", () => {
		const { db, jobId } = setupCollapseDb();
		// Cluster 1: day0
		const id1 = insertResult(db, jobId, {
			published_date: "2024-01-01",
			title: LONG_TITLE,
			url: "https://source-a.com/acme-multi-1",
		});
		// Cluster 2: 18 months later
		const id2 = insertResult(db, jobId, {
			published_date: "2025-07-01",
			title: LONG_TITLE,
			url: "https://source-b.com/acme-multi-2",
		});
		// Undated — ambiguous which cluster it belongs to
		const idUndated = insertResult(db, jobId, {
			published_date: null,
			title: LONG_TITLE,
			url: "https://source-c.com/acme-multi-undated",
		});
		collapse(db, jobId);
		// Both dated cluster winners stay included
		assert.equal(getResult(db, id1).status, "included");
		assert.equal(getResult(db, id2).status, "included");
		// Undated stays included — cannot guess which cluster
		assert.equal(getResult(db, idUndated).status, "included");
		db.close();
	});
});

describe("collapse — all-unknown group collapses to first-seen (lowest id)", () => {
	it("three undated results with same title → lowest id wins, others excluded", () => {
		const { db, jobId } = setupCollapseDb();
		const idFirst = insertResult(db, jobId, {
			published_date: null,
			title: LONG_TITLE,
			url: "https://source-a.com/acme-alldated-1",
		});
		const idSecond = insertResult(db, jobId, {
			published_date: null,
			title: LONG_TITLE,
			url: "https://source-b.com/acme-alldated-2",
		});
		const idThird = insertResult(db, jobId, {
			published_date: null,
			title: LONG_TITLE,
			url: "https://source-c.com/acme-alldated-3",
		});
		collapse(db, jobId);
		// Lowest id is winner
		assert.equal(getResult(db, idFirst).status, "included");
		// Others are excluded as duplicates
		const r2 = getResult(db, idSecond);
		const r3 = getResult(db, idThird);
		assert.equal(r2.status, "excluded");
		assert.equal(r2.exclusion_code, "duplicate");
		assert.equal(r2.exclusion_detail, `of #${idFirst}`);
		assert.equal(r3.status, "excluded");
		assert.equal(r3.exclusion_code, "duplicate");
		assert.equal(r3.exclusion_detail, `of #${idFirst}`);
		db.close();
	});
});

describe("collapse — boundary at exactly 14 days still collapses", () => {
	it("day0 and day14 → same cluster → loser excluded", () => {
		const { db, jobId } = setupCollapseDb();
		const id0 = insertResult(db, jobId, {
			published_date: "2025-01-01",
			title: LONG_TITLE,
			url: "https://techcrunch.com/acme-boundary-0",
		});
		const id14 = insertResult(db, jobId, {
			published_date: "2025-01-15",
			title: LONG_TITLE,
			url: "https://reuters.com/acme-boundary-14",
		});
		collapse(db, jobId);
		assert.equal(getResult(db, id0).status, "included");
		const r14 = getResult(db, id14);
		assert.equal(r14.status, "excluded");
		assert.equal(r14.exclusion_code, "duplicate");
		assert.equal(r14.exclusion_detail, `of #${id0}`);
		db.close();
	});
});
