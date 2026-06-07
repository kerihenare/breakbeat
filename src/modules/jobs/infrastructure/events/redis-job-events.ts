import { Inject, Injectable } from "@nestjs/common";
import type Redis from "ioredis";
import { REDIS } from "../../../../shared/redis/redis.tokens";
import type { JobEvents } from "../../domain/ports/job-events.port";

function channel(jobId: string): string {
	return `job:${jobId}`;
}

@Injectable()
export class RedisJobEvents implements JobEvents {
	constructor(@Inject(REDIS) private readonly redis: Redis) {}

	async publish(jobId: string): Promise<void> {
		await this.redis.publish(channel(jobId), "1");
	}

	async subscribe(
		jobId: string,
		onEvent: () => void,
	): Promise<() => Promise<void>> {
		// A subscriber connection cannot issue normal commands, so use a dedicated
		// duplicate per SSE client.
		const sub = this.redis.duplicate();
		await sub.subscribe(channel(jobId));
		sub.on("message", () => onEvent());
		return async () => {
			await sub.unsubscribe(channel(jobId));
			sub.disconnect();
		};
	}
}
