import { Module } from "@nestjs/common";
import { CoreModule } from "./core.module";

// Worker root: core infrastructure only. Sentry is instrumented globally via
// instrument.ts; BullMQ processors arrive in Slice 3 (aglow-ti2.3).
@Module({ imports: [CoreModule] })
export class WorkerModule {}
