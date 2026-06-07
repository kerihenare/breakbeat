import { Job } from "../domain/job";
import type { IdGenerator } from "../domain/ports/id-generator.port";
import type { ResultRepository } from "../domain/ports/result-repository.port";
import type {
	SearchHit,
	SearchProvider,
} from "../domain/ports/search-provider.port";
import type { ResolvedIdentity } from "../domain/resolved-identity";
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
	};
	return { inserted, repo };
}

const hit = (url: string): SearchHit => ({
	content: null,
	publishedDate: null,
	sourceDomain: "x",
	title: "t",
	url,
});

describe("SearchStage", () => {
	it("inserts hits and dedups by normalized url", async () => {
		const provider: SearchProvider = {
			isConfigured: () => true,
			search: async () => [hit("https://a.com/x"), hit("https://a.com/x")],
		};
		const { repo, inserted } = repoStub();
		const job = makeJob();
		await new SearchStage(provider, repo, ids).run(job);
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
		const { repo } = repoStub();
		const job = makeJob();
		await new SearchStage(provider, repo, ids).run(job);
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
		const { repo } = repoStub();
		const job = makeJob();
		await new SearchStage(provider, repo, ids).run(job);
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
		const { repo } = repoStub();
		const job = makeJob();
		await expect(new SearchStage(provider, repo, ids).run(job)).rejects.toThrow(
			/all search queries failed/,
		);
	});
});
