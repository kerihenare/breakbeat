import { TerminusModule } from "@nestjs/terminus";
import { Test } from "@nestjs/testing";
import { DatabaseHealthIndicator } from "./database.health";
import { HealthController } from "./health.controller";
import { RedisHealthIndicator } from "./redis.health";

describe("HealthController", () => {
	it("reports overall ok when db and redis are up", async () => {
		const moduleRef = await Test.createTestingModule({
			controllers: [HealthController],
			imports: [TerminusModule],
			providers: [
				{
					provide: DatabaseHealthIndicator,
					useValue: { isHealthy: async () => ({ database: { status: "up" } }) },
				},
				{
					provide: RedisHealthIndicator,
					useValue: { isHealthy: async () => ({ redis: { status: "up" } }) },
				},
			],
		}).compile();

		const controller = moduleRef.get(HealthController);
		const result = await controller.check();
		expect(result.status).toBe("ok");
		expect(result.info?.database?.status).toBe("up");
		expect(result.info?.redis?.status).toBe("up");
	});
});
