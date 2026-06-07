import { Controller, Get } from "@nestjs/common";
import {
	HealthCheck,
	type HealthCheckResult,
	HealthCheckService,
} from "@nestjs/terminus";
import { DatabaseHealthIndicator } from "./database.health";
import { RedisHealthIndicator } from "./redis.health";

@Controller("health")
export class HealthController {
	constructor(
		private readonly health: HealthCheckService,
		private readonly db: DatabaseHealthIndicator,
		private readonly redis: RedisHealthIndicator,
	) {}

	@Get()
	@HealthCheck()
	check(): Promise<HealthCheckResult> {
		return this.health.check([
			() => this.db.isHealthy(),
			() => this.redis.isHealthy(),
		]);
	}
}
