import "reflect-metadata";
import "./shared/config/load-env";
import { parseEnv } from "./shared/config/env.schema";
import { initSentry } from "./shared/observability/sentry";

// Side-effect module imported first by both entrypoints so Sentry instruments
// the runtime before any application code (and Nest) loads.
const { env } = parseEnv(process.env);
initSentry(env.SENTRY_DSN, env.NODE_ENV);
