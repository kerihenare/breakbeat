import type { ContentType } from "../domain/content-type";
import type { Confidence, Exclusion } from "../domain/exclusion";
import { Job } from "../domain/job";
import type {
	Classifier,
	ClassifyVerdict,
} from "../domain/ports/classifier.port";
import type { ContentExtractor } from "../domain/ports/content-extractor.port";
import type { ResultRepository } from "../domain/ports/result-repository.port";
import { Result } from "../domain/result";
import { ClassifyStage } from "./classify-stage";

const WINDOW = { end: "2026-06-08", start: "2023-06-08" };

function makeJob(): Job {
	return new Job("j1", "Acme", "https://acme.com", WINDOW, new Date(), {
		resolvedIdentity: {
			domains: ["acme.com"],
			handles: [],
			name: "Acme",
			negativeMatches: [],
			provenance: "url_provided",
			window: WINDOW,
		},
	});
}

type Recorded =
	| {
			kind: "classified";
			id: string;
			type: ContentType | null;
			conf: Confidence;
	  }
	| { kind: "excluded"; id: string; ex: Exclusion };

function repoStub(results: Result[]): {
	repo: ResultRepository;
	recorded: Recorded[];
} {
	const recorded: Recorded[] = [];
	const repo: ResultRepository = {
		findAllByJob: async () => results,
		findIncludedByJob: async () => results.filter((r) => !r.isExcluded),
		insertIfNew: async () => true,
		markClassified: async (id, type, conf) => {
			recorded.push({ conf, id, kind: "classified", type });
		},
		markExcluded: async (id, ex) => {
			recorded.push({ ex, id, kind: "excluded" });
		},
	};
	return { recorded, repo };
}

const extractorOff: ContentExtractor = {
	extract: async () => new Map(),
	isConfigured: () => false,
};

function result(id: string): Result {
	return new Result(
		id,
		"j1",
		`https://n/${id}`,
		`n/${id}`,
		"Title",
		"n",
		"2025-01-01",
	);
}

describe("ClassifyStage", () => {
	it("warns and does nothing when the classifier is unconfigured", async () => {
		const classifier: Classifier = {
			classify: async () => [],
			isConfigured: () => false,
		};
		const { repo, recorded } = repoStub([result("a")]);
		const job = makeJob();
		await new ClassifyStage(repo, extractorOff, classifier).run(job);
		expect(recorded).toEqual([]);
		expect(job.warnings.some((w) => w.message.includes("not configured"))).toBe(
			true,
		);
	});

	it("applies content types and LLM exclusions", async () => {
		const verdicts: ClassifyVerdict[] = [
			{ confidence: "high", contentType: "news", exclude: "none", id: "a" },
			{
				confidence: "low",
				contentType: "other",
				exclude: "own_channel",
				id: "b",
			},
		];
		const classifier: Classifier = {
			classify: async () => verdicts,
			isConfigured: () => true,
		};
		const { repo, recorded } = repoStub([result("a"), result("b")]);
		const job = makeJob();
		await new ClassifyStage(repo, extractorOff, classifier).run(job);
		expect(recorded).toContainEqual({
			conf: "high",
			id: "a",
			kind: "classified",
			type: "news",
		});
		expect(recorded).toContainEqual({
			ex: { code: "own_channel", detail: "LLM" },
			id: "b",
			kind: "excluded",
		});
	});

	it("warns when some results are left unclassified", async () => {
		const classifier: Classifier = {
			classify: async () => [
				{ confidence: "high", contentType: "news", exclude: "none", id: "a" },
			],
			isConfigured: () => true,
		};
		const { repo } = repoStub([result("a"), result("b")]);
		const job = makeJob();
		await new ClassifyStage(repo, extractorOff, classifier).run(job);
		expect(job.warnings.some((w) => /not classified/.test(w.message))).toBe(
			true,
		);
	});
});
