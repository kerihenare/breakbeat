import { Job } from "../domain/job";
import type { IdGenerator } from "../domain/ports/id-generator.port";
import type { ResultRepository } from "../domain/ports/result-repository.port";
import type {
	SearchHit,
	SearchProvider,
} from "../domain/ports/search-provider.port";
import type { WebSearchBackstop } from "../domain/ports/web-search-backstop.port";
import type { ResolvedIdentity } from "../domain/resolved-identity";
import {
	buildBackstopQueries,
	buildEscalationQueries,
	buildSearchQueries,
	TAVILY_THIN_THRESHOLD,
} from "../domain/services/search-queries";
import { SearchStage } from "./search-stage";

const identity: ResolvedIdentity = {
	domains: ["acme.com"],
	handles: [],
	name: "Acme",
	negativeMatches: [],
	provenance: "url_provided",
	window: { end: "2026-06-08", start: "2023-06-08" },
};

function makeJob(): Job {
	return new Job(
		"j1",
		"Acme",
		"https://acme.com",
		identity.window,
		new Date(),
		{
			resolvedIdentity: identity,
		},
	);
}

let counter = 0;
const ids: IdGenerator = { next: () => `id-${++counter}` };

function repoStub(): { repo: ResultRepository; inserted: string[] } {
	const inserted: string[] = [];
	const repo: ResultRepository = {
		findAllByJob: async () => [],
		findIncludedByJob: async () => [],
		insertIfNew: async (r) => {
			if (inserted.includes(r.normalizedUrl)) return false;
			inserted.push(r.normalizedUrl);
			return true;
		},
		markClassified: async () => {},
		markExcluded: async () => {},
		setVerification: async () => {},
	};
	return { inserted, repo };
}

const hit = (url: string): SearchHit => ({
	content: null,
	publishedDate: null,
	score: null,
	sourceDomain: "x",
	title: "t",
	url,
});

function backstopStub(
	configured: boolean,
	returnHits: SearchHit[] = [],
): { backstop: WebSearchBackstop; calls: string[] } {
	const calls: string[] = [];
	const backstop: WebSearchBackstop = {
		isConfigured: () => configured,
		search: async (q) => {
			calls.push(q);
			return returnHits;
		},
	};
	return { backstop, calls };
}

describe("SearchStage", () => {
	it("inserts hits and dedups by normalized url", async () => {
		const provider: SearchProvider = {
			isConfigured: () => true,
			search: async () => [hit("https://a.com/x"), hit("https://a.com/x")],
		};
		const { backstop } = backstopStub(false);
		const { repo, inserted } = repoStub();
		const job = makeJob();
		await new SearchStage(provider, backstop, repo, ids).run(job);
		expect(inserted).toEqual(["a.com/x"]);
	});

	it("warns when unconfigured and never calls the provider", async () => {
		let called = 0;
		const provider: SearchProvider = {
			isConfigured: () => false,
			search: async () => {
				called++;
				return [];
			},
		};
		const { backstop } = backstopStub(false);
		const { repo } = repoStub();
		const job = makeJob();
		await new SearchStage(provider, backstop, repo, ids).run(job);
		expect(called).toBe(0);
		expect(job.warnings.some((w) => w.message.includes("not configured"))).toBe(
			true,
		);
	});

	it("warns on partial query failure", async () => {
		let n = 0;
		const provider: SearchProvider = {
			isConfigured: () => true,
			search: async () => {
				n++;
				if (n % 2 === 0) throw new Error("boom");
				return [];
			},
		};
		const { backstop } = backstopStub(false);
		const { repo } = repoStub();
		const job = makeJob();
		await new SearchStage(provider, backstop, repo, ids).run(job);
		expect(job.warnings.some((w) => /queries failed/.test(w.message))).toBe(
			true,
		);
	});

	it("throws when all queries fail", async () => {
		const provider: SearchProvider = {
			isConfigured: () => true,
			search: async () => {
				throw new Error("boom");
			},
		};
		const { backstop } = backstopStub(false);
		const { repo } = repoStub();
		const job = makeJob();
		await expect(
			new SearchStage(provider, backstop, repo, ids).run(job),
		).rejects.toThrow(/all search queries failed/);
	});

	it("merges Tavily and backstop hits in the default path", async () => {
		// Tavily returns >= TAVILY_THIN_THRESHOLD hits across all queries.
		// We spread them across queries: query 0 returns threshold hits, rest return [].
		const _tavilyQueries = buildSearchQueries(identity);
		const broadQueries = buildBackstopQueries(identity);
		const escalationQueries = buildEscalationQueries(identity);

		// Build enough hits to meet the threshold
		const tavilyHits = Array.from({ length: TAVILY_THIN_THRESHOLD }, (_, i) =>
			hit(`https://news${i}.com/article`),
		);
		let tavilyCallCount = 0;
		const provider: SearchProvider = {
			isConfigured: () => true,
			search: async () => {
				const idx = tavilyCallCount++;
				return idx === 0 ? tavilyHits : [];
			},
		};

		// Backstop returns one distinct hit from its broad queries
		const backstopHit = hit("https://backstop-source.com/story");
		const { backstop, calls: backstopCalls } = backstopStub(true, [
			backstopHit,
		]);
		const { repo, inserted } = repoStub();
		const job = makeJob();

		await new SearchStage(provider, backstop, repo, ids).run(job);

		// Both Tavily and backstop URLs should be inserted
		for (const h of tavilyHits) {
			expect(inserted).toContain(
				new URL(h.url).hostname.replace(/^www\./, "") + new URL(h.url).pathname,
			);
		}
		expect(inserted).toContain("backstop-source.com/story");

		// Escalation NOT triggered — backstop called only broadQueries.length times
		expect(backstopCalls.length).toBe(broadQueries.length);
		// Specifically NOT called escalation query count more times
		expect(backstopCalls.length).not.toBe(
			broadQueries.length + escalationQueries.length,
		);
		// All backstop calls should be the broad queries
		for (const q of broadQueries) {
			expect(backstopCalls).toContain(q);
		}
	});

	it("escalates to the full angle set when Tavily is thin", async () => {
		// Tavily returns FEWER than TAVILY_THIN_THRESHOLD usable hits
		const broadQueries = buildBackstopQueries(identity);
		const escalationQueries = buildEscalationQueries(identity);

		// Return fewer hits than the threshold (threshold - 1)
		const thinHits = Array.from({ length: TAVILY_THIN_THRESHOLD - 1 }, (_, i) =>
			hit(`https://thin${i}.com/article`),
		);
		let tavilyCallCount = 0;
		const provider: SearchProvider = {
			isConfigured: () => true,
			search: async () => {
				const idx = tavilyCallCount++;
				return idx === 0 ? thinHits : [];
			},
		};

		const { backstop, calls: backstopCalls } = backstopStub(true, []);
		const { repo } = repoStub();
		const job = makeJob();

		await new SearchStage(provider, backstop, repo, ids).run(job);

		// Backstop should be called for both broad queries AND escalation queries
		expect(backstopCalls.length).toBe(
			broadQueries.length + escalationQueries.length,
		);
	});

	it("does not escalate when Tavily is healthy", async () => {
		const broadQueries = buildBackstopQueries(identity);

		// Tavily returns exactly threshold hits — healthy, no escalation
		const healthyHits = Array.from({ length: TAVILY_THIN_THRESHOLD }, (_, i) =>
			hit(`https://healthy${i}.com/article`),
		);
		let tavilyCallCount = 0;
		const provider: SearchProvider = {
			isConfigured: () => true,
			search: async () => {
				const idx = tavilyCallCount++;
				return idx === 0 ? healthyHits : [];
			},
		};

		const { backstop, calls: backstopCalls } = backstopStub(true, []);
		const { repo } = repoStub();
		const job = makeJob();

		await new SearchStage(provider, backstop, repo, ids).run(job);

		// Backstop called only broad-query count times (no escalation)
		expect(backstopCalls.length).toBe(broadQueries.length);
	});

	it("degrades to a Warning (no throw) when backstop unconfigured and Tavily queries succeed but return zero", async () => {
		const provider: SearchProvider = {
			isConfigured: () => true,
			search: async () => [],
		};
		const { backstop } = backstopStub(false);
		const { repo, inserted } = repoStub();
		const job = makeJob();

		// Should NOT throw
		await expect(
			new SearchStage(provider, backstop, repo, ids).run(job),
		).resolves.toBeUndefined();

		expect(inserted).toHaveLength(0);
	});

	it("fails the Job only when both providers fail to produce any successful response", async () => {
		// Tavily configured but every query REJECTS; backstop unconfigured
		const provider: SearchProvider = {
			isConfigured: () => true,
			search: async () => {
				throw new Error("network error");
			},
		};
		const { backstop } = backstopStub(false);
		const { repo } = repoStub();
		const job = makeJob();

		await expect(
			new SearchStage(provider, backstop, repo, ids).run(job),
		).rejects.toThrow(/all search queries failed/);
	});

	it("warns and returns when neither provider is configured", async () => {
		let tavilyCalls = 0;
		const provider: SearchProvider = {
			isConfigured: () => false,
			search: async () => {
				tavilyCalls++;
				return [];
			},
		};
		const { backstop, calls: backstopCalls } = backstopStub(false);
		const { repo } = repoStub();
		const job = makeJob();

		await new SearchStage(provider, backstop, repo, ids).run(job);

		expect(tavilyCalls).toBe(0);
		expect(backstopCalls).toHaveLength(0);
		expect(job.warnings.some((w) => w.message.includes("not configured"))).toBe(
			true,
		);
	});
});
