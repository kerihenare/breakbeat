import type { Exclusion } from "../domain/exclusion";
import { Job } from "../domain/job";
import type { ResultRepository } from "../domain/ports/result-repository.port";
import type {
	ResultVerifier,
	VerifyVerdict,
} from "../domain/ports/result-verifier.port";
import type { VerificationStatus } from "../domain/result";
import { Result } from "../domain/result";
import { VerifyStage } from "./verify-stage";

const WINDOW = { end: "2026-06-08", start: "2023-06-08" };

function makeJob(withContext = true): Job {
	return new Job("j1", "Acme", "https://acme.com", WINDOW, new Date(), {
		resolvedIdentity: {
			context: withContext
				? {
						aliases: [],
						description: "A dev tools company.",
						industry: "Software",
					}
				: null,
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
	| { kind: "verified"; id: string; status: VerificationStatus }
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
		markClassified: async () => {},
		markExcluded: async (id, ex) => {
			recorded.push({ ex, id, kind: "excluded" });
		},
		setVerification: async (id, status) => {
			recorded.push({ id, kind: "verified", status });
		},
	};
	return { recorded, repo };
}

function result(id: string): Result {
	return new Result(
		id,
		"j1",
		`https://n/${id}`,
		`n/${id}`,
		"Title",
		"n",
		"2025-01-01",
		"snippet",
	);
}

function verifier(
	verdicts: VerifyVerdict[],
	configured = true,
): ResultVerifier {
	return { isConfigured: () => configured, verify: async () => verdicts };
}

describe("VerifyStage", () => {
	it("excludes a high-confidence mismatch as off_topic/LLM", async () => {
		const { repo, recorded } = repoStub([result("a")]);
		await new VerifyStage(
			repo,
			verifier([{ confidence: "high", decision: "mismatch", id: "a" }]),
		).run(makeJob());
		expect(recorded).toContainEqual({
			ex: { code: "off_topic", detail: "LLM" },
			id: "a",
			kind: "excluded",
		});
	});

	it("marks a match as verified", async () => {
		const { repo, recorded } = repoStub([result("a")]);
		await new VerifyStage(
			repo,
			verifier([{ confidence: "high", decision: "match", id: "a" }]),
		).run(makeJob());
		expect(recorded).toContainEqual({
			id: "a",
			kind: "verified",
			status: "verified",
		});
	});

	it("marks an uncertain verdict (and a low-confidence mismatch) as uncertain — never excluded", async () => {
		const { repo, recorded } = repoStub([result("a"), result("b")]);
		await new VerifyStage(
			repo,
			verifier([
				{ confidence: "low", decision: "uncertain", id: "a" },
				{ confidence: "low", decision: "mismatch", id: "b" },
			]),
		).run(makeJob());
		expect(recorded).toContainEqual({
			id: "a",
			kind: "verified",
			status: "uncertain",
		});
		expect(recorded).toContainEqual({
			id: "b",
			kind: "verified",
			status: "uncertain",
		});
		expect(recorded.some((r) => r.kind === "excluded")).toBe(false);
	});

	it("warns and does nothing when the verifier is unconfigured", async () => {
		const { repo, recorded } = repoStub([result("a")]);
		const job = makeJob();
		await new VerifyStage(repo, verifier([], false)).run(job);
		expect(recorded).toEqual([]);
		expect(job.warnings.some((w) => /not configured/.test(w.message))).toBe(
			true,
		);
	});

	it("warns and does nothing when there is no brand context", async () => {
		const { repo, recorded } = repoStub([result("a")]);
		const job = makeJob(false);
		await new VerifyStage(
			repo,
			verifier([{ confidence: "high", decision: "match", id: "a" }]),
		).run(job);
		expect(recorded).toEqual([]);
		expect(job.warnings.some((w) => /no brand context/.test(w.message))).toBe(
			true,
		);
	});
});
