import { Global, Inject, Module, type OnModuleDestroy } from "@nestjs/common";
import Redis from "ioredis";
import { AppConfigService } from "../config/app-config.service";
import { withTimeout } from "../util/with-timeout";
import { REDIS } from "./redis.tokens";

const QUIT_TIMEOUT_MS = 5000;

const redisProvider = {
	inject: [AppConfigService],
	provide: REDIS,
	useFactory: (config: AppConfigService) =>
		new Redis(config.get("REDIS_URL"), {
			lazyConnect: false,
			maxRetriesPerRequest: null,
		}),
};

@Global()
@Module({ exports: [REDIS], providers: [redisProvider] })
export class RedisModule implements OnModuleDestroy {
	constructor(@Inject(REDIS) private readonly redis: Redis) {}

	async onModuleDestroy(): Promise<void> {
		// Bound the graceful quit so shutdown can't hang on an unresponsive
		// Redis; fall back to a forced disconnect.
		try {
			await withTimeout(this.redis.quit(), QUIT_TIMEOUT_MS, "redis quit");
		} catch {
			this.redis.disconnect();
		}
	}
}
