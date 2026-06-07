import * as Sentry from "@sentry/nestjs";

/**
 * Initialise Sentry pointed at the Bugsink DSN. No-op when SENTRY_DSN is unset,
 * so a keyless clone still boots. MUST run before the Nest app is created,
 * which is why it is called from `instrument.ts` (imported first by each entry).
 */
export function initSentry(dsn: string | undefined, environment: string): void {
	if (!dsn) {
		process.stdout.write(
			"[sentry] SENTRY_DSN not set — error reporting disabled.\n",
		);
		return;
	}
	Sentry.init({ dsn, environment, tracesSampleRate: 0 });
}
