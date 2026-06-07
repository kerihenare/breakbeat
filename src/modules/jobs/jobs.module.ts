import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { AppConfigService } from "../../shared/config/app-config.service";
import { ConfigModule } from "../../shared/config/config.module";
import { PipelineService } from "./application/pipeline.service";
import { SubmitJob } from "./application/submit-job.use-case";
import { CLOCK } from "./domain/ports/clock.port";
import { ID_GENERATOR } from "./domain/ports/id-generator.port";
import { JOB_EVENTS } from "./domain/ports/job-events.port";
import { JOB_QUEUE } from "./domain/ports/job-queue.port";
import { JOB_REPOSITORY } from "./domain/ports/job-repository.port";
import { RESULT_REPOSITORY } from "./domain/ports/result-repository.port";
import { SystemClock } from "./infrastructure/clock";
import { RedisJobEvents } from "./infrastructure/events/redis-job-events";
import { UuidGenerator } from "./infrastructure/id-generator";
import { DrizzleJobRepository } from "./infrastructure/persistence/job.repository";
import { DrizzleResultRepository } from "./infrastructure/persistence/result.repository";
import {
	BullmqJobQueue,
	PIPELINE_QUEUE,
} from "./infrastructure/queue/bullmq-job-queue";
import { JobEventsController } from "./interface/job-events.controller";
import { JobsController } from "./interface/jobs.controller";

function redisConnection(config: AppConfigService): {
	host: string;
	port: number;
} {
	const url = new URL(config.get("REDIS_URL"));
	return { host: url.hostname, port: Number(url.port) || 6379 };
}

// Core bounded context: Job + Result aggregates, the submit flow, the stub
// pipeline, and the HTTP delivery. Domain ports → Postgres/Redis/BullMQ
// adapters. The BullMQ @Processor is provided only in WorkerModule.
@Module({
	controllers: [JobsController, JobEventsController],
	exports: [
		CLOCK,
		ID_GENERATOR,
		JOB_REPOSITORY,
		RESULT_REPOSITORY,
		JOB_QUEUE,
		JOB_EVENTS,
		PipelineService,
	],
	imports: [
		BullModule.forRootAsync({
			imports: [ConfigModule],
			inject: [AppConfigService],
			useFactory: (config: AppConfigService) => ({
				connection: redisConnection(config),
			}),
		}),
		BullModule.registerQueue({ name: PIPELINE_QUEUE }),
	],
	providers: [
		{ provide: CLOCK, useClass: SystemClock },
		{ provide: ID_GENERATOR, useClass: UuidGenerator },
		{ provide: JOB_REPOSITORY, useClass: DrizzleJobRepository },
		{ provide: RESULT_REPOSITORY, useClass: DrizzleResultRepository },
		{ provide: JOB_QUEUE, useClass: BullmqJobQueue },
		{ provide: JOB_EVENTS, useClass: RedisJobEvents },
		SubmitJob,
		PipelineService,
	],
})
export class JobsModule {}
