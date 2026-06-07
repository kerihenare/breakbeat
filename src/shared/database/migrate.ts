import "reflect-metadata";
import "../config/load-env";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { parseEnv } from "../config/env.schema";

async function main(): Promise<void> {
	const { env } = parseEnv(process.env);
	const sql = postgres(env.DATABASE_URL, { max: 1 });
	try {
		await migrate(drizzle(sql), { migrationsFolder: "./migrations" });
		process.stdout.write("[migrate] migrations applied\n");
	} finally {
		await sql.end({ timeout: 5 });
	}
}

main().catch((err) => {
	process.stderr.write(`[migrate] failed: ${String(err)}\n`);
	process.exit(1);
});
