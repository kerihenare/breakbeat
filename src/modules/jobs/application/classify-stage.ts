import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Job } from "../domain/job";
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

	async run(job: Job): Promise<void> {
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

		const contentByUrl = this.extractor.isConfigured()
			? await this.extractor.extract(included.map((r) => r.url))
			: new Map<string, string>();

		const inputs: ClassifyInput[] = included.map((r) => ({
			content: contentByUrl.get(r.url) ?? r.snippet ?? null,
			id: r.id,
			sourceDomain: r.sourceDomain,
			title: r.title,
			url: r.url,
		}));

		const chunks = chunk(inputs, CLASSIFY_CHUNK_SIZE);
		const outcomes = await Promise.allSettled(
			chunks.map((c) => this.classifier.classify(c, identity)),
		);

		let failedChunks = 0;
		const classifiedIds = new Set<string>();
		for (const outcome of outcomes) {
			if (outcome.status === "rejected") {
				failedChunks++;
				continue;
			}
			for (const v of outcome.value as ClassifyVerdict[]) {
				classifiedIds.add(v.id);
				if (v.exclude !== "none") {
					await this.results.markExcluded(v.id, {
						code: v.exclude,
						detail: "LLM",
					});
				} else {
					await this.results.markClassified(v.id, v.contentType, v.confidence);
				}
			}
		}

		const missing = inputs.filter((i) => !classifiedIds.has(i.id)).length;
		if (failedChunks > 0) {
			job.addWarning(
				`${failedChunks}/${chunks.length} classification batches failed — some results left unclassified`,
			);
		} else if (missing > 0) {
			job.addWarning(`${missing} result(s) were not classified`);
		}
		this.logger.log(
			`classify ${job.id}: ${classifiedIds.size}/${inputs.length} classified, ${failedChunks} batch failure(s)`,
		);
	}
}
