import { Inject, Injectable } from "@nestjs/common";
import {
	type HealthIndicatorResult,
	HealthIndicatorService,
} from "@nestjs/terminus";
import type Redis from "ioredis";
import { REDIS } from "../../shared/redis/redis.tokens";
import { withTimeout } from "../../shared/util/with-timeout";

const PING_TIMEOUT_MS = 2000;

@Injectable()
export class RedisHealthIndicator {
	constructor(
		private readonly healthIndicatorService: HealthIndicatorService,
		@Inject(REDIS) private readonly redis: Redis,
	) {}

	async isHealthy(key = "redis"): Promise<HealthIndicatorResult> {
		const indicator = this.healthIndicatorService.check(key);
		try {
			const pong = await withTimeout(
				this.redis.ping(),
				PING_TIMEOUT_MS,
				"redis ping",
			);
			return pong === "PONG" ? indicator.up() : indicator.down({ pong });
		} catch (err) {
			return indicator.down({ message: String(err) });
		}
	}
}
