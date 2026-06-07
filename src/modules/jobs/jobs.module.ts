import { Module } from "@nestjs/common";
import { CLOCK } from "./domain/ports/clock.port";
import { ID_GENERATOR } from "./domain/ports/id-generator.port";
import { JOB_REPOSITORY } from "./domain/ports/job-repository.port";
import { RESULT_REPOSITORY } from "./domain/ports/result-repository.port";
import { SystemClock } from "./infrastructure/clock";
import { UuidGenerator } from "./infrastructure/id-generator";
import { DrizzleJobRepository } from "./infrastructure/persistence/job.repository";
import { DrizzleResultRepository } from "./infrastructure/persistence/result.repository";

// Core bounded context: Job + Result aggregates. Binds domain ports to their
// Postgres adapters. DRIZZLE comes from the global DatabaseModule (Slice 1).
@Module({
	exports: [CLOCK, ID_GENERATOR, JOB_REPOSITORY, RESULT_REPOSITORY],
	providers: [
		{ provide: CLOCK, useClass: SystemClock },
		{ provide: ID_GENERATOR, useClass: UuidGenerator },
		{ provide: JOB_REPOSITORY, useClass: DrizzleJobRepository },
		{ provide: RESULT_REPOSITORY, useClass: DrizzleResultRepository },
	],
})
export class JobsModule {}
