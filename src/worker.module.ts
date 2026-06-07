import { Module } from "@nestjs/common";
import { CoreModule } from "./core.module";
import { PipelineProcessor } from "./modules/jobs/infrastructure/queue/pipeline.processor";

// Worker root: core infrastructure + the BullMQ @Processor (provided only here,
// so the HTTP process never consumes the queue). Sentry is instrumented via
// instrument.ts.
@Module({
	imports: [CoreModule],
	providers: [PipelineProcessor],
})
export class WorkerModule {}
