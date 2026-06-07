import { Inject, Injectable, Logger } from "@nestjs/common";
import type { ContentType } from "../domain/content-type";
import type { ExclusionCode } from "../domain/exclusion";
import type { Job } from "../domain/job";
import type { JobStatus } from "../domain/job-status";
import {
	ID_GENERATOR,
	type IdGenerator,
} from "../domain/ports/id-generator.port";
import { JOB_EVENTS, type JobEvents } from "../domain/ports/job-events.port";
import {
	JOB_REPOSITORY,
	type JobRepository,
} from "../domain/ports/job-repository.port";
import {
	RESULT_REPOSITORY,
	type ResultRepository,
} from "../domain/ports/result-repository.port";
import { Result } from "../domain/result";
import { normalizeUrl } from "../domain/services/normalize";

type StubHit = {
	title: string;
	url: string;
	domain: string;
	date: string | null;
	type: ContentType | null;
	exclude?: { code: ExclusionCode; detail: string };
};

// A believable spread so the grouped list and excluded audit section both
// populate. Replaced by real Resolve/Search/Filter/Classify in Slices 4–7.
const STUB_HITS: StubHit[] = [
	{
		date: "2025-11-02",
		domain: "bloomberg.com",
		title: "Acme raises $40M Series B to expand platform",
		type: "news",
		url: "https://bloomberg.com/news/acme-series-b",
	},
	{
		date: "2025-09-18",
		domain: "reuters.com",
		title: "Acme names new chief executive amid rapid growth",
		type: "news",
		url: "https://reuters.com/business/acme-ceo",
	},
	{
		date: "2025-07-30",
		domain: "theverge.com",
		title: "Inside Acme's bet on developer tooling",
		type: "news",
		url: "https://theverge.com/acme-developer-tooling",
	},
	{
		date: "2025-06-11",
		domain: "tradetechtoday.com",
		title: "Acme partners with industry body on data standards",
		type: "trade_publication",
		url: "https://tradetechtoday.com/acme-data-standards",
	},
	{
		date: "2025-10-05",
		domain: "prnewswire.com",
		title: "Acme announces general availability of v3 platform",
		type: "press_release",
		url: "https://prnewswire.com/acme-v3-ga",
	},
	{
		date: "2025-08-21",
		domain: "businesswire.com",
		title: "Acme appoints VP of Engineering (press release)",
		type: "press_release",
		url: "https://businesswire.com/acme-vp-eng",
	},
	{
		date: "2025-05-14",
		domain: "podcasts.example.fm",
		title: "Acme's founder on building in public — podcast",
		type: "podcast",
		url: "https://podcasts.example.fm/acme-founder",
	},
	{
		date: "2025-09-01",
		domain: "devblog.example.io",
		title: "Why we switched to Acme: an engineering retrospective",
		type: "blog_post",
		url: "https://devblog.example.io/switched-to-acme",
	},
	{
		date: "2025-04-22",
		domain: "medium.com",
		title: "A field guide to Acme's pricing changes",
		type: "blog_post",
		url: "https://medium.com/@analyst/acme-pricing",
	},
	{
		date: "2025-10-19",
		domain: "substack.com",
		title: "This week in fintech: Acme, regulation, and more",
		type: "newsletter",
		url: "https://substack.com/fintechweekly/acme",
	},
	{
		date: "2025-11-03",
		domain: "x.com",
		title: "Big news from Acme today 🎉 congrats to the team",
		type: "social_post",
		url: "https://x.com/journalist/status/999",
	},
	{
		date: "2025-03-10",
		domain: "example.org",
		title: "Acme mentioned in a roundup of notable startups",
		type: null,
		url: "https://example.org/notable-startups-2025",
	},
	{
		date: "2025-10-01",
		domain: "acme.com",
		exclude: { code: "own_channel", detail: "acme.com" },
		title: "Acme blog: our roadmap for next year",
		type: null,
		url: "https://acme.com/blog/roadmap",
	},
	{
		date: "2025-08-02",
		domain: "reddit.com",
		exclude: { code: "aggregator", detail: "reddit.com" },
		title: "Discussion: anyone using Acme in production?",
		type: null,
		url: "https://reddit.com/r/devtools/acme",
	},
];

const STAGE_DELAY_MS = 600;

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

@Injectable()
export class PipelineService {
	private readonly logger = new Logger(PipelineService.name);

	constructor(
		@Inject(JOB_REPOSITORY) private readonly jobs: JobRepository,
		@Inject(RESULT_REPOSITORY) private readonly results: ResultRepository,
		@Inject(JOB_EVENTS) private readonly events: JobEvents,
		@Inject(ID_GENERATOR) private readonly ids: IdGenerator,
	) {}

	async run(jobId: string): Promise<void> {
		const job = await this.jobs.findById(jobId);
		if (!job) {
			this.logger.warn(`job ${jobId} not found`);
			return;
		}
		try {
			await this.advance(job, "resolving");
			await this.advance(job, "searching");
			const ids = await this.insertStubResults(job.id);
			await this.advance(job, "filtering");
			await this.filterStub(ids);
			await this.advance(job, "classifying");
			await this.classifyStub(ids);
			job.finalize();
			await this.jobs.save(job);
			await this.events.publish(job.id);
		} catch (err) {
			this.logger.error(`pipeline failed for ${jobId}: ${String(err)}`);
			job.transitionTo("failed", String(err));
			await this.jobs.save(job);
			await this.events.publish(job.id);
		}
	}

	private async advance(job: Job, to: JobStatus): Promise<void> {
		job.transitionTo(to);
		await this.jobs.save(job);
		await this.events.publish(job.id);
		await delay(STAGE_DELAY_MS);
	}

	private async insertStubResults(
		jobId: string,
	): Promise<Map<string, StubHit>> {
		const byId = new Map<string, StubHit>();
		for (const hit of STUB_HITS) {
			const id = this.ids.next();
			const result = new Result(
				id,
				jobId,
				hit.url,
				normalizeUrl(hit.url),
				hit.title,
				hit.domain,
				hit.date,
			);
			await this.results.insertIfNew(result);
			byId.set(id, hit);
		}
		await this.events.publish(jobId);
		return byId;
	}

	private async filterStub(ids: Map<string, StubHit>): Promise<void> {
		for (const [id, hit] of ids) {
			if (hit.exclude) {
				await this.results.markExcluded(id, {
					code: hit.exclude.code,
					detail: hit.exclude.detail,
				});
			}
		}
	}

	private async classifyStub(ids: Map<string, StubHit>): Promise<void> {
		for (const [id, hit] of ids) {
			if (hit.exclude) continue; // excluded rows aren't classified
			await this.results.markClassified(
				id,
				hit.type,
				hit.type ? "high" : "low",
			);
		}
	}
}
