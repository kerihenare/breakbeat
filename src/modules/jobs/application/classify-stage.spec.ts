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

	// Records every URL the extractor is asked for; returns "FULL:<url>" content.
	function recordingExtractor(): {
		extractor: ContentExtractor;
		requested: string[];
	} {
		const requested: string[] = [];
		const extractor: ContentExtractor = {
			extract: async (urls) => {
				requested.push(...urls);
				return new Map(urls.map((u) => [u, `FULL:${u}`]));
			},
			isConfigured: () => true,
		};
		return { extractor, requested };
	}

	// First call → Pass 1 (snippet); subsequent calls → Pass 2 (full text).
	function twoPassClassifier(
		pass1: ClassifyVerdict[],
		pass2: (inputs: { id: string }[]) => ClassifyVerdict[] | never,
	): Classifier {
		let call = 0;
		return {
			classify: async (inputs) => {
				call += 1;
				return call === 1 ? pass1 : pass2(inputs);
			},
			isConfigured: () => true,
		};
	}

	it("extracts only Pass-1 survivors, never Pass-1 exclusions", async () => {
		const { extractor, requested } = recordingExtractor();
		const classifier = twoPassClassifier(
			[
				{ confidence: "low", contentType: "news", exclude: "none", id: "a" },
				{
					confidence: "high",
					contentType: "other",
					exclude: "own_channel",
					id: "b",
				},
			],
			(inputs) =>
				inputs.map((i) => ({
					confidence: "high" as const,
					contentType: "news" as const,
					exclude: "none" as const,
					id: i.id,
				})),
		);
		const { repo } = repoStub([result("a"), result("b")]);
		await new ClassifyStage(repo, extractor, classifier).run(makeJob());
		expect(requested).toEqual(["https://n/a"]);
	});

	it("re-classifies survivors on full text, overwriting the Pass-1 verdict once", async () => {
		const { extractor } = recordingExtractor();
		const classifier = twoPassClassifier(
			[
				{
					confidence: "low",
					contentType: "blog_post",
					exclude: "none",
					id: "a",
				},
			],
			(inputs) =>
				inputs.map((i) => ({
					confidence: "high" as const,
					contentType: "news" as const,
					exclude: "none" as const,
					id: i.id,
				})),
		);
		const { repo, recorded } = repoStub([result("a")]);
		await new ClassifyStage(repo, extractor, classifier).run(makeJob());
		const forA = recorded.filter((r) => r.id === "a");
		expect(forA).toEqual([
			{ conf: "high", id: "a", kind: "classified", type: "news" },
		]);
	});

	it("keeps the Pass-1 verdict when extraction yields no content for a survivor", async () => {
		const emptyExtractor: ContentExtractor = {
			extract: async () => new Map(),
			isConfigured: () => true,
		};
		let calls = 0;
		const classifier: Classifier = {
			classify: async () => {
				calls += 1;
				return [
					{
						confidence: "low",
						contentType: "blog_post",
						exclude: "none",
						id: "a",
					},
				];
			},
			isConfigured: () => true,
		};
		const { repo, recorded } = repoStub([result("a")]);
		await new ClassifyStage(repo, emptyExtractor, classifier).run(makeJob());
		expect(calls).toBe(1); // no Pass 2 when there is no extracted content
		expect(recorded).toEqual([
			{ conf: "low", id: "a", kind: "classified", type: "blog_post" },
		]);
	});

	it("keeps the Pass-1 verdict and warns when a Pass-2 batch fails", async () => {
		const { extractor } = recordingExtractor();
		const classifier = twoPassClassifier(
			[{ confidence: "low", contentType: "news", exclude: "none", id: "a" }],
			() => {
				throw new Error("pass-2 boom");
			},
		);
		const { repo, recorded } = repoStub([result("a")]);
		const job = makeJob();
		await new ClassifyStage(repo, extractor, classifier).run(job);
		expect(recorded).toEqual([
			{ conf: "low", id: "a", kind: "classified", type: "news" },
		]);
		expect(job.warnings.some((w) => /refinement/.test(w.message))).toBe(true);
	});

	it("classifies on snippets only and warns when the extractor is unconfigured", async () => {
		let calls = 0;
		const classifier: Classifier = {
			classify: async () => {
				calls += 1;
				return [
					{ confidence: "low", contentType: "news", exclude: "none", id: "a" },
				];
			},
			isConfigured: () => true,
		};
		const { repo, recorded } = repoStub([result("a")]);
		const job = makeJob();
		await new ClassifyStage(repo, extractorOff, classifier).run(job);
		expect(calls).toBe(1);
		expect(recorded).toEqual([
			{ conf: "low", id: "a", kind: "classified", type: "news" },
		]);
		expect(job.warnings.some((w) => /snippets only/.test(w.message))).toBe(
			true,
		);
	});

	it("reports the extracting then refining phases when survivors are extracted", async () => {
		const { extractor } = recordingExtractor();
		const classifier = twoPassClassifier(
			[{ confidence: "low", contentType: "news", exclude: "none", id: "a" }],
			(inputs) =>
				inputs.map((i) => ({
					confidence: "high" as const,
					contentType: "news" as const,
					exclude: "none" as const,
					id: i.id,
				})),
		);
		const { repo } = repoStub([result("a")]);
		const phases: string[] = [];
		await new ClassifyStage(repo, extractor, classifier).run(
			makeJob(),
			async (s) => {
				phases.push(s);
			},
		);
		expect(phases).toEqual(["extracting", "refining"]);
	});

	it("reports no sub-phases when the extractor is unconfigured", async () => {
		const classifier: Classifier = {
			classify: async () => [
				{ confidence: "low", contentType: "news", exclude: "none", id: "a" },
			],
			isConfigured: () => true,
		};
		const { repo } = repoStub([result("a")]);
		const phases: string[] = [];
		await new ClassifyStage(repo, extractorOff, classifier).run(
			makeJob(),
			async (s) => {
				phases.push(s);
			},
		);
		expect(phases).toEqual([]);
	});

	it("reports extracting but not refining when no survivor has extracted content", async () => {
		const emptyExtractor: ContentExtractor = {
			extract: async () => new Map(),
			isConfigured: () => true,
		};
		const classifier: Classifier = {
			classify: async () => [
				{ confidence: "low", contentType: "news", exclude: "none", id: "a" },
			],
			isConfigured: () => true,
		};
		const { repo } = repoStub([result("a")]);
		const phases: string[] = [];
		await new ClassifyStage(repo, emptyExtractor, classifier).run(
			makeJob(),
			async (s) => {
				phases.push(s);
			},
		);
		expect(phases).toEqual(["extracting"]);
	});
});
