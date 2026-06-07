import { Module } from "@nestjs/common";
import { TerminusModule } from "@nestjs/terminus";
import { DatabaseHealthIndicator } from "./database.health";
import { HealthController } from "./health.controller";
import { RedisHealthIndicator } from "./redis.health";

@Module({
	controllers: [HealthController],
	imports: [TerminusModule],
	providers: [DatabaseHealthIndicator, RedisHealthIndicator],
})
export class HealthModule {}
