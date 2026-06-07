import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { AppConfigService } from "../../shared/config/app-config.service";
import { ConfigModule } from "../../shared/config/config.module";
import { PipelineService } from "./application/pipeline.service";
import { ResolveStage } from "./application/resolve-stage";
import { SubmitJob } from "./application/submit-job.use-case";
import { BRAND_DIRECTORY } from "./domain/ports/brand-directory.port";
import { CLOCK } from "./domain/ports/clock.port";
import { ID_GENERATOR } from "./domain/ports/id-generator.port";
import { JOB_EVENTS } from "./domain/ports/job-events.port";
import { JOB_QUEUE } from "./domain/ports/job-queue.port";
import { JOB_REPOSITORY } from "./domain/ports/job-repository.port";
import { RESULT_REPOSITORY } from "./domain/ports/result-repository.port";
import { WEB_CONTEXT } from "./domain/ports/web-context.port";
import { BrandfetchClient } from "./infrastructure/brandfetch/brandfetch-client";
import { SystemClock } from "./infrastructure/clock";
import { RedisJobEvents } from "./infrastructure/events/redis-job-events";
import { GoogleContext } from "./infrastructure/google/google-context";
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
	const raw = config.get("REDIS_URL");
	try {
		const url = new URL(raw);
		return { host: url.hostname, port: Number(url.port) || 6379 };
	} catch {
		throw new Error(`Invalid REDIS_URL: ${JSON.stringify(raw)}`);
	}
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
		{ provide: BRAND_DIRECTORY, useClass: BrandfetchClient },
		{ provide: WEB_CONTEXT, useClass: GoogleContext },
		SubmitJob,
		ResolveStage,
		PipelineService,
	],
})
export class JobsModule {}
