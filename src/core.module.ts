import { Module } from "@nestjs/common";
import { ConfigModule } from "./shared/config/config.module";
import { DatabaseModule } from "./shared/database/database.module";
import { LoggingModule } from "./shared/observability/logging.module";
import { RedisModule } from "./shared/redis/redis.module";

// Cross-cutting infrastructure shared by both the HTTP app and the worker.
@Module({
	exports: [ConfigModule, LoggingModule, DatabaseModule, RedisModule],
	imports: [ConfigModule, LoggingModule, DatabaseModule, RedisModule],
})
export class CoreModule {}
