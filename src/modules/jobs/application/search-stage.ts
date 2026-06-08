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
	type SearchHit,
	type SearchProvider,
} from "../domain/ports/search-provider.port";
import {
	WEB_SEARCH_BACKSTOP,
	type WebSearchBackstop,
} from "../domain/ports/web-search-backstop.port";
import { Result } from "../domain/result";
import { normalizeUrl } from "../domain/services/normalize";
import {
	buildBackstopQueries,
	buildEscalationQueries,
	buildSearchQueries,
	TAVILY_THIN_THRESHOLD,
} from "../domain/services/search-queries";

@Injectable()
export class SearchStage {
	private readonly logger = new Logger(SearchStage.name);

	constructor(
		@Inject(SEARCH_PROVIDER) private readonly provider: SearchProvider,
		@Inject(WEB_SEARCH_BACKSTOP) private readonly backstop: WebSearchBackstop,
		@Inject(RESULT_REPOSITORY) private readonly results: ResultRepository,
		@Inject(ID_GENERATOR) private readonly ids: IdGenerator,
	) {}

	async run(job: Job): Promise<void> {
		const identity = job.resolvedIdentity;
		if (!identity) {
			job.addWarning("search skipped — no resolved identity");
			return;
		}
		const tavilyOn = this.provider.isConfigured();
		const backstopOn = this.backstop.isConfigured();
		if (!tavilyOn && !backstopOn) {
			job.addWarning("search not configured — no results fetched");
			return;
		}

		const tavilyQueries = buildSearchQueries(identity);
		const backstopQueries = buildBackstopQueries(identity);

		const [tavily, backstopDefault] = await Promise.all([
			tavilyOn
				? Promise.allSettled(tavilyQueries.map((q) => this.provider.search(q)))
				: Promise.resolve([] as PromiseSettledResult<SearchHit[]>[]),
			backstopOn
				? Promise.allSettled(
						backstopQueries.map((q) => this.backstop.search(q)),
					)
				: Promise.resolve([] as PromiseSettledResult<SearchHit[]>[]),
		]);

		const tavily_ = this.tally(tavily);
		const backstop_ = this.tally(backstopDefault);
		let inserted =
			(await this.insertAll(job, tavily_.hits)) +
			(await this.insertAll(job, backstop_.hits));
		let anySucceeded = tavily_.succeeded > 0 || backstop_.succeeded > 0;

		if (backstopOn && tavily_.hitCount < TAVILY_THIN_THRESHOLD) {
			const escalated = this.tally(
				await Promise.allSettled(
					buildEscalationQueries(identity).map((q) => this.backstop.search(q)),
				),
			);
			inserted += await this.insertAll(job, escalated.hits);
			anySucceeded = anySucceeded || escalated.succeeded > 0;
			this.logger.log(
				`search ${job.id}: escalated backstop (${escalated.succeeded} ok)`,
			);
		}

		if (tavilyOn && tavily_.failed > 0) {
			job.addWarning(
				`${tavily_.failed}/${tavilyQueries.length} Tavily search queries failed`,
			);
		}
		if (backstopOn && backstop_.failed > 0) {
			job.addWarning(
				`${backstop_.failed}/${backstopQueries.length} backstop search queries failed`,
			);
		}
		this.logger.log(
			`search ${job.id}: ${inserted} results inserted (tavily hits=${tavily_.hitCount})`,
		);

		if (!anySucceeded) {
			throw new Error("all search queries failed — no results fetched");
		}
	}

	private tally(outcomes: PromiseSettledResult<SearchHit[]>[]): {
		succeeded: number;
		failed: number;
		hitCount: number;
		hits: SearchHit[];
	} {
		let succeeded = 0;
		let failed = 0;
		const hits: SearchHit[] = [];
		for (const o of outcomes) {
			if (o.status === "rejected") {
				failed++;
				continue;
			}
			succeeded++;
			hits.push(...o.value);
		}
		return { failed, hitCount: hits.length, hits, succeeded };
	}

	private async insertAll(job: Job, hits: SearchHit[]): Promise<number> {
		let inserted = 0;
		for (const hit of hits) {
			let normalizedUrl: string;
			try {
				normalizedUrl = normalizeUrl(hit.url);
			} catch {
				continue;
			}
			const result = new Result(
				this.ids.next(),
				job.id,
				hit.url,
				normalizedUrl,
				hit.title,
				hit.sourceDomain,
				hit.publishedDate,
				hit.content,
				hit.score,
			);
			if (await this.results.insertIfNew(result)) inserted++;
		}
		return inserted;
	}
}
