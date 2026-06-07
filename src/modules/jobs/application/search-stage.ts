import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Job } from "../domain/job";
import {
	ID_GENERATOR,
	type IdGenerator,
} from "../domain/ports/id-generator.port";
import {
	RESULT_REPOSITORY,
	type ResultRepository,
} from "../domain/ports/result-repository.port";
import {
	SEARCH_PROVIDER,
	type SearchProvider,
} from "../domain/ports/search-provider.port";
import { Result } from "../domain/result";
import { normalizeUrl } from "../domain/services/normalize";
import { buildSearchQueries } from "../domain/services/search-queries";

/**
 * Real Search: fan out the Tavily query set built from the Resolved Identity,
 * insert each hit with insert-time URL dedup. A partial failure is a Warning;
 * an all-fail (when configured) fails the Job. Unconfigured degrades to a
 * Warning and zero results.
 */
@Injectable()
export class SearchStage {
	private readonly logger = new Logger(SearchStage.name);

	constructor(
		@Inject(SEARCH_PROVIDER) private readonly provider: SearchProvider,
		@Inject(RESULT_REPOSITORY) private readonly results: ResultRepository,
		@Inject(ID_GENERATOR) private readonly ids: IdGenerator,
	) {}

	async run(job: Job): Promise<void> {
		const identity = job.resolvedIdentity;
		if (!identity) {
			job.addWarning("search skipped — no resolved identity");
			return;
		}
		if (!this.provider.isConfigured()) {
			job.addWarning("search not configured — no results fetched");
			return;
		}

		const queries = buildSearchQueries(identity);
		const outcomes = await Promise.allSettled(
			queries.map((q) => this.provider.search(q)),
		);

		let succeeded = 0;
		let failed = 0;
		let inserted = 0;
		for (const outcome of outcomes) {
			if (outcome.status === "rejected") {
				failed++;
				continue;
			}
			succeeded++;
			for (const hit of outcome.value) {
				let normalizedUrl: string;
				try {
					normalizedUrl = normalizeUrl(hit.url);
				} catch {
					continue; // skip unparseable URLs
				}
				const result = new Result(
					this.ids.next(),
					job.id,
					hit.url,
					normalizedUrl,
					hit.title,
					hit.sourceDomain,
					hit.publishedDate,
				);
				if (await this.results.insertIfNew(result)) inserted++;
			}
		}

		this.logger.log(
			`search ${job.id}: ${succeeded}/${queries.length} queries ok, ${inserted} results inserted`,
		);
		if (failed > 0) {
			job.addWarning(`${failed}/${queries.length} search queries failed`);
		}
		if (succeeded === 0) {
			throw new Error("all search queries failed — no results fetched");
		}
	}
}
