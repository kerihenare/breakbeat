import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import type { Job as BullJob } from "bullmq";
import { PipelineService } from "../../application/pipeline.service";
import { PIPELINE_QUEUE } from "./bullmq-job-queue";

// Registered ONLY in WorkerModule, so the HTTP process never processes jobs.
@Processor(PIPELINE_QUEUE)
export class PipelineProcessor extends WorkerHost {
	private readonly logger = new Logger(PipelineProcessor.name);

	constructor(private readonly pipeline: PipelineService) {
		super();
	}

	async process(job: BullJob<{ jobId: string }>): Promise<void> {
		this.logger.log(`processing job ${job.data.jobId}`);
		await this.pipeline.run(job.data.jobId);
	}
}
