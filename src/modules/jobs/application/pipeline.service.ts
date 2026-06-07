import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Job } from "../domain/job";
import type { JobStatus } from "../domain/job-status";
import { JOB_EVENTS, type JobEvents } from "../domain/ports/job-events.port";
import {
	JOB_REPOSITORY,
	type JobRepository,
} from "../domain/ports/job-repository.port";
import { FilterStage } from "./filter-stage";
import { ResolveStage } from "./resolve-stage";
import { SearchStage } from "./search-stage";

const STAGE_DELAY_MS = 400;

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Orchestrates the pipeline. Resolve (Slice 4) and Search (Slice 5) are real;
 * Filter (Slice 6) and Classify (Slice 7) are no-op transitions for now —
 * results stay `included` and unclassified until those slices land.
 */
@Injectable()
export class PipelineService {
	private readonly logger = new Logger(PipelineService.name);

	constructor(
		@Inject(JOB_REPOSITORY) private readonly jobs: JobRepository,
		@Inject(JOB_EVENTS) private readonly events: JobEvents,
		private readonly resolve: ResolveStage,
		private readonly search: SearchStage,
		private readonly filter: FilterStage,
	) {}

	async run(jobId: string): Promise<void> {
		const job = await this.jobs.findById(jobId);
		if (!job) {
			this.logger.warn(`job ${jobId} not found`);
			return;
		}
		try {
			await this.enter(job, "resolving");
			await this.resolve.run(job);
			await this.persist(job);

			await this.enter(job, "searching");
			await this.search.run(job);
			await this.persist(job);

			await this.enter(job, "filtering");
			await this.filter.run(job);
			await this.persist(job);

			await this.enter(job, "classifying"); // no-op (Slice 7)

			job.finalize();
			await this.persist(job);
		} catch (err) {
			this.logger.error(`pipeline failed for ${jobId}: ${String(err)}`);
			job.transitionTo("failed", String(err));
			await this.persist(job);
		}
	}

	private async enter(job: Job, to: JobStatus): Promise<void> {
		job.transitionTo(to);
		await this.persist(job);
		await delay(STAGE_DELAY_MS);
	}

	private async persist(job: Job): Promise<void> {
		await this.jobs.save(job);
		await this.events.publish(job.id);
	}
}
