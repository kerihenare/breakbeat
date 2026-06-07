import { existsSync } from "node:fs";

// Natively load .env into process.env (no dotenv dependency) for code paths that
// read the environment before @nestjs/config runs: instrument.ts and the
// standalone db:migrate / db:reset scripts. In containers .env is absent
// (provided via compose `environment:`), so this is a no-op there.
const ENV_PATH = ".env";
if (existsSync(ENV_PATH)) {
	process.loadEnvFile(ENV_PATH);
}
