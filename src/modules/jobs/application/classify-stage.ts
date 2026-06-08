import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Job } from "../domain/job";
import type { JobStatus } from "../domain/job-status";
import {
	CLASSIFIER,
	type Classifier,
	type ClassifyVerdict,
} from "../domain/ports/classifier.port";
import {
	CONTENT_EXTRACTOR,
	type ContentExtractor,
} from "../domain/ports/content-extractor.port";
import {
	RESULT_REPOSITORY,
	type ResultRepository,
} from "../domain/ports/result-repository.port";
import type { ResolvedIdentity } from "../domain/resolved-identity";
import {
	CLASSIFY_CAP,
	CLASSIFY_CHUNK_SIZE,
	type ClassifyInput,
} from "../domain/services/classify-prompt";

function chunk<T>(items: T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size)
		out.push(items.slice(i, i + size));
	return out;
}

/**
 * Real Classify: Tavily-Extract page content per surviving Result, then batch
 * through Claude Haiku to assign a Content Type and backstop own_channel/
 * aggregator/ecommerce. Classify failure is a Warning (the reviewable list is
 * the Job's purpose), never a Job failure; Extract failures degrade to snippet.
 */
@Injectable()
export class ClassifyStage {
	private readonly logger = new Logger(ClassifyStage.name);

	constructor(
		@Inject(RESULT_REPOSITORY) private readonly results: ResultRepository,
		@Inject(CONTENT_EXTRACTOR) private readonly extractor: ContentExtractor,
		@Inject(CLASSIFIER) private readonly classifier: Classifier,
	) {}

	/**
	 * @param reportPhase Optional hook the pipeline supplies to surface the two
	 *   internal Classify sub-phases as live status — `extracting` (before the
	 *   Tavily Extract of survivors) and `refining` (before the full-text Pass 2).
	 *   Each fires only when that work actually runs.
	 */
	async run(
		job: Job,
		reportPhase: (status: JobStatus) => Promise<void> = async () => {},
	): Promise<void> {
		if (!this.classifier.isConfigured()) {
			job.addWarning(
				"classification not configured — results left unclassified",
			);
			return;
		}

		let included = await this.results.findIncludedByJob(job.id);
		if (included.length === 0) return;
		if (included.length > CLASSIFY_CAP) {
			job.addWarning(
				`classified the first ${CLASSIFY_CAP} of ${included.length} results`,
			);
			included = included.slice(0, CLASSIFY_CAP);
		}

		const identity: ResolvedIdentity = job.resolvedIdentity ?? {
			domains: [],
			handles: [],
			name: job.companyName,
			negativeMatches: [],
			provenance: "none",
			window: job.window,
		};

		// Pass 1 — classify on the search snippet (no Extract). Cheap triage that
		// drops obvious own_channel/aggregator/ecommerce before paying to extract.
		const pass1 = await this.classifyBatch(
			included.map((r) => this.toInput(r, r.snippet ?? null)),
			identity,
		);

		// Survivors are still `included` after Pass 1 — verdict "none", or no
		// verdict at all (a Pass-1 miss still gets a Pass-2 chance). LLM-excluded
		// Results are never extracted.
		const survivors = included.filter(
			(r) => (pass1.verdicts.get(r.id)?.exclude ?? "none") === "none",
		);

		// Extract full page content for survivors only.
		let contentByUrl = new Map<string, string>();
		if (!this.extractor.isConfigured()) {
			job.addWarning(
				"content extraction not configured — results classified on snippets only",
			);
		} else if (survivors.length > 0) {
			await reportPhase("extracting");
			contentByUrl = await this.extractor.extract(survivors.map((r) => r.url));
		}

		// Pass 2 — re-classify survivors that have extracted text, on full text.
		const pass2Inputs = survivors
			.map((r) => this.toInput(r, contentByUrl.get(r.url) ?? null))
			.filter((i) => i.content !== null && i.content !== "");
		let pass2: {
			verdicts: Map<string, ClassifyVerdict>;
			failedChunks: number;
			chunkCount: number;
		} = { chunkCount: 0, failedChunks: 0, verdicts: new Map() };
		if (pass2Inputs.length > 0) {
			await reportPhase("refining");
			pass2 = await this.classifyBatch(pass2Inputs, identity);
		}

		// Merge: Pass 2 wins where present, Pass 1 is the floor. One write per
		// Result so a failed Extract/Pass-2 never regresses a verdict.
		const classifiedIds = new Set<string>();
		const writes: Promise<void>[] = [];
		for (const r of included) {
			const v = pass2.verdicts.get(r.id) ?? pass1.verdicts.get(r.id);
			if (!v) continue;
			classifiedIds.add(r.id);
			writes.push(
				v.exclude !== "none"
					? this.results.markExcluded(v.id, { code: v.exclude, detail: "LLM" })
					: this.results.markClassified(v.id, v.contentType, v.confidence),
			);
		}
		// Persist concurrently — the postgres.js pool bounds real parallelism.
		await Promise.all(writes);

		if (pass1.failedChunks > 0) {
			job.addWarning(
				`${pass1.failedChunks}/${pass1.chunkCount} classification batches failed — some results left unclassified`,
			);
		}
		if (pass2.failedChunks > 0) {
			job.addWarning(
				`${pass2.failedChunks}/${pass2.chunkCount} refinement batches failed — kept the snippet classification`,
			);
		}
		const missing = included.filter((r) => !classifiedIds.has(r.id)).length;
		if (pass1.failedChunks === 0 && pass2.failedChunks === 0 && missing > 0) {
			job.addWarning(`${missing} result(s) were not classified`);
		}
		this.logger.log(
			`classify ${job.id}: ${classifiedIds.size}/${included.length} classified, ${survivors.length} survivor(s) extracted, ${pass1.failedChunks + pass2.failedChunks} batch failure(s)`,
		);
	}

	private toInput(
		r: { id: string; title: string; url: string; sourceDomain: string },
		content: string | null,
	): ClassifyInput {
		return {
			content,
			id: r.id,
			sourceDomain: r.sourceDomain,
			title: r.title,
			url: r.url,
		};
	}

	/** Chunk → classify concurrently → collect verdicts by id, counting failures. */
	private async classifyBatch(
		inputs: ClassifyInput[],
		identity: ResolvedIdentity,
	): Promise<{
		verdicts: Map<string, ClassifyVerdict>;
		failedChunks: number;
		chunkCount: number;
	}> {
		const chunks = chunk(inputs, CLASSIFY_CHUNK_SIZE);
		const outcomes = await Promise.allSettled(
			chunks.map((c) => this.classifier.classify(c, identity)),
		);
		const verdicts = new Map<string, ClassifyVerdict>();
		let failedChunks = 0;
		for (const outcome of outcomes) {
			if (outcome.status === "rejected") {
				failedChunks++;
				continue;
			}
			for (const v of outcome.value) verdicts.set(v.id, v);
		}
		return { chunkCount: chunks.length, failedChunks, verdicts };
	}
}
