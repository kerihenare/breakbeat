import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Job } from "../domain/job";
import {
	RESULT_REPOSITORY,
	type ResultRepository,
} from "../domain/ports/result-repository.port";
import type { ResolvedIdentity } from "../domain/resolved-identity";
import { collapse } from "../domain/services/collapse";
import { heuristicExclusion } from "../domain/services/heuristics";

/**
 * Real Filter: apply the deterministic heuristic Exclusions, then Collapse
 * near-duplicate titles over the still-included Results — persisting the
 * decisions made by the (already unit-tested) pure domain services.
 */
@Injectable()
export class FilterStage {
	private readonly logger = new Logger(FilterStage.name);

	constructor(
		@Inject(RESULT_REPOSITORY) private readonly results: ResultRepository,
	) {}

	async run(job: Job): Promise<void> {
		const windowStart = new Date(job.window.start);
		const identity: ResolvedIdentity = job.resolvedIdentity ?? {
			domains: [],
			handles: [],
			name: job.companyName,
			negativeMatches: [],
			provenance: "none",
			window: job.window,
		};

		// 1. Heuristics — own_channel / aggregator / ecommerce_review / out_of_window.
		const included = await this.results.findIncludedByJob(job.id);
		let excluded = 0;
		for (const r of included) {
			const exclusion = heuristicExclusion(
				{
					publishedDate: r.publishedDate,
					sourceDomain: r.sourceDomain,
					title: r.title,
					url: r.url,
				},
				identity,
				windowStart,
			);
			if (exclusion) {
				await this.results.markExcluded(r.id, exclusion);
				excluded++;
			}
		}

		// 2. Collapse — over still-included Results only.
		const survivors = await this.results.findIncludedByJob(job.id);
		const decisions = collapse(
			survivors.map((r) => ({
				id: r.id,
				publishedDate: r.publishedDate,
				title: r.title,
			})),
		);
		for (const d of decisions) {
			await this.results.markExcluded(d.loserId, {
				code: "duplicate",
				detail: `of #${d.winnerId}`,
			});
		}

		this.logger.log(
			`filter ${job.id}: ${excluded} heuristic exclusion(s), ${decisions.length} collapsed`,
		);
	}
}
