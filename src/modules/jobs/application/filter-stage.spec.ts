import type { Exclusion } from "../domain/exclusion";
import { Job } from "../domain/job";
import type { ResultRepository } from "../domain/ports/result-repository.port";
import type { ResolvedIdentity } from "../domain/resolved-identity";
import { Result } from "../domain/result";
import { FilterStage } from "./filter-stage";

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

function result(
	id: string,
	url: string,
	title: string,
	domain: string,
	date: string | null,
): Result {
	return new Result("".concat(id), "j1", url, url, title, domain, date);
}

class FakeRepo implements ResultRepository {
	constructor(public items: Result[]) {}
	async insertIfNew(): Promise<boolean> {
		return true;
	}
	async findIncludedByJob(jobId: string): Promise<Result[]> {
		return this.items.filter((r) => r.jobId === jobId && !r.isExcluded);
	}
	async findAllByJob(jobId: string): Promise<Result[]> {
		return this.items.filter((r) => r.jobId === jobId);
	}
	async markExcluded(id: string, exclusion: Exclusion): Promise<void> {
		this.items
			.find((r) => r.id === id)
			?.exclude(exclusion.code, exclusion.detail);
	}
	async markClassified(): Promise<void> {}
}

function byId(items: Result[], id: string): Result | undefined {
	return items.find((r) => r.id === id);
}

describe("FilterStage", () => {
	it("excludes own-domain and aggregator rows via heuristics, keeps real coverage", async () => {
		const items = [
			result(
				"a",
				"https://acme.com/blog",
				"Our roadmap for next year ahead",
				"acme.com",
				"2025-01-01",
			),
			result(
				"b",
				"https://reddit.com/r/x",
				"Anyone using the product in production",
				"reddit.com",
				"2025-01-01",
			),
			result(
				"c",
				"https://news.example/s",
				"A legitimate news story about the company today",
				"news.example",
				"2025-01-01",
			),
		];
		const repo = new FakeRepo(items);
		await new FilterStage(repo).run(makeJob());
		expect(byId(items, "a")?.exclusion?.code).toBe("own_channel");
		expect(byId(items, "b")?.exclusion?.code).toBe("aggregator");
		expect(byId(items, "c")?.isExcluded).toBe(false);
	});

	it("collapses duplicate titles to the earliest copy", async () => {
		const LONG = "Acme raises a giant funding round this year";
		const items = [
			result("late", "https://p.example/1", LONG, "p.example", "2025-01-10"),
			result("early", "https://q.example/2", LONG, "q.example", "2025-01-01"),
		];
		const repo = new FakeRepo(items);
		await new FilterStage(repo).run(makeJob());
		expect(byId(items, "late")?.exclusion?.code).toBe("duplicate");
		expect(byId(items, "late")?.exclusion?.detail).toBe("of #early");
		expect(byId(items, "early")?.isExcluded).toBe(false);
	});
});
