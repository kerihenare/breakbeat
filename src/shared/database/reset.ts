import "reflect-metadata";
import "../config/load-env";
import postgres from "postgres";
import { parseEnv } from "../config/env.schema";

async function main(): Promise<void> {
	const { env } = parseEnv(process.env);
	if (env.NODE_ENV === "production") {
		throw new Error("db:reset is refused in production");
	}
	const sql = postgres(env.DATABASE_URL, { max: 1 });
	try {
		await sql.unsafe("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
		process.stdout.write("[reset] public schema dropped and recreated\n");
	} finally {
		await sql.end({ timeout: 5 });
	}
}

main().catch((err) => {
	process.stderr.write(`[reset] failed: ${String(err)}\n`);
	process.exit(1);
});
