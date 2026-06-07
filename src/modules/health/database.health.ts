import { Inject, Injectable } from "@nestjs/common";
import {
	type HealthIndicatorResult,
	HealthIndicatorService,
} from "@nestjs/terminus";
import type postgres from "postgres";
import { PG_SQL } from "../../shared/database/database.tokens";
import { withTimeout } from "../../shared/util/with-timeout";

const QUERY_TIMEOUT_MS = 2000;

@Injectable()
export class DatabaseHealthIndicator {
	constructor(
		private readonly healthIndicatorService: HealthIndicatorService,
		@Inject(PG_SQL) private readonly sql: postgres.Sql,
	) {}

	async isHealthy(key = "database"): Promise<HealthIndicatorResult> {
		const indicator = this.healthIndicatorService.check(key);
		try {
			await withTimeout(
				this.sql`SELECT 1`,
				QUERY_TIMEOUT_MS,
				"database health",
			);
			return indicator.up();
		} catch (err) {
			return indicator.down({ message: String(err) });
		}
	}
}
