import { InjectQueue } from "@nestjs/bullmq";
import { Injectable } from "@nestjs/common";
import type { Queue } from "bullmq";
import type { JobQueue } from "../../domain/ports/job-queue.port";

export const PIPELINE_QUEUE = "pipeline";

@Injectable()
export class BullmqJobQueue implements JobQueue {
	constructor(@InjectQueue(PIPELINE_QUEUE) private readonly queue: Queue) {}

	async enqueue(jobId: string): Promise<void> {
		await this.queue.add(
			"run",
			{ jobId },
			{ removeOnComplete: true, removeOnFail: 100 },
		);
	}
}
