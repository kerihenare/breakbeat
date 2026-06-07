import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { Job } from "../domain/job";
import { CLOCK, type Clock } from "../domain/ports/clock.port";
import {
	ID_GENERATOR,
	type IdGenerator,
} from "../domain/ports/id-generator.port";
import { JOB_QUEUE, type JobQueue } from "../domain/ports/job-queue.port";
import {
	JOB_REPOSITORY,
	type JobRepository,
} from "../domain/ports/job-repository.port";
import { normalizeHost } from "../domain/services/normalize";
import { computeWindow } from "../domain/window";

export type SubmitJobInput = {
	companyName: string;
	homepageUrl: string | null;
	chosenDomain?: string | null;
};

@Injectable()
export class SubmitJob {
	constructor(
		@Inject(CLOCK) private readonly clock: Clock,
		@Inject(ID_GENERATOR) private readonly ids: IdGenerator,
		@Inject(JOB_REPOSITORY) private readonly jobs: JobRepository,
		@Inject(JOB_QUEUE) private readonly queue: JobQueue,
	) {}

	async execute(input: SubmitJobInput): Promise<Job> {
		const name = input.companyName.trim();
		const url = input.homepageUrl?.trim() ? input.homepageUrl.trim() : null;

		if (!name && !url) {
			throw new BadRequestException("Provide a company name or homepage URL.");
		}
		if (url) {
			let parsed: URL;
			try {
				parsed = new URL(url);
			} catch {
				throw new BadRequestException("Homepage URL is not a valid URL.");
			}
			if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
				throw new BadRequestException("Homepage URL must use http or https.");
			}
		}

		const now = this.clock.now();
		const displayName = name || (url ? normalizeHost(url) : "");
		const chosenDomain =
			input.chosenDomain?.trim() || (url ? normalizeHost(url) : null);
		const job = new Job(
			this.ids.next(),
			displayName,
			url,
			computeWindow(now),
			now,
			{ chosenDomain },
		);

		await this.jobs.save(job);
		await this.queue.enqueue(job.id);
		return job;
	}
}
