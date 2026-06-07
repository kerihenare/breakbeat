import { Module } from "@nestjs/common";
import { JobsModule } from "./modules/jobs/jobs.module";
import { ConfigModule } from "./shared/config/config.module";
import { DatabaseModule } from "./shared/database/database.module";
import { LoggingModule } from "./shared/observability/logging.module";
import { RedisModule } from "./shared/redis/redis.module";

// Cross-cutting infrastructure shared by both the HTTP app and the worker,
// plus the core jobs bounded context.
@Module({
	exports: [
		ConfigModule,
		LoggingModule,
		DatabaseModule,
		RedisModule,
		JobsModule,
	],
	imports: [
		ConfigModule,
		LoggingModule,
		DatabaseModule,
		RedisModule,
		JobsModule,
	],
})
export class CoreModule {}
