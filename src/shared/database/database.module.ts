import { Global, Inject, Module, type OnModuleDestroy } from "@nestjs/common";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { AppConfigService } from "../config/app-config.service";
import { DRIZZLE, PG_SQL } from "./database.tokens";
import * as schema from "./schema";

const sqlProvider = {
	inject: [AppConfigService],
	provide: PG_SQL,
	useFactory: (config: AppConfigService) =>
		postgres(config.get("DATABASE_URL"), { max: 10 }),
};

const drizzleProvider = {
	inject: [PG_SQL],
	provide: DRIZZLE,
	useFactory: (sql: postgres.Sql) => drizzle(sql, { schema }),
};

@Global()
@Module({
	exports: [DRIZZLE, PG_SQL],
	providers: [sqlProvider, drizzleProvider],
})
export class DatabaseModule implements OnModuleDestroy {
	constructor(@Inject(PG_SQL) private readonly sql: postgres.Sql) {}

	async onModuleDestroy(): Promise<void> {
		await this.sql.end({ timeout: 5 });
	}
}
