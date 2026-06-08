import "./instrument";
import { join } from "node:path";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Logger } from "nestjs-pino";
import { AppModule } from "./app.module";
import { AppConfigService } from "./shared/config/app-config.service";

async function bootstrap(): Promise<void> {
	const app = await NestFactory.create<NestExpressApplication>(AppModule, {
		bufferLogs: true,
	});
	app.useLogger(app.get(Logger));
	app.useStaticAssets(join(process.cwd(), "public"));
	app.enableShutdownHooks();

	const config = app.get(AppConfigService);
	const logger = app.get(Logger);
	const port = config.get("PORT");

	// On the shutdown signal, sever lingering keep-alive / SSE sockets so the HTTP
	// server closes promptly (closeAllConnections() is Node ≥18.2). In dev, also
	// force-exit shortly after: the watcher (`node --watch`) waits for this process
	// to terminate before restarting, and a lingering Redis / Postgres / BullMQ
	// handle can otherwise keep the event loop alive indefinitely — leaving the app
	// down, or its replacement racing a still-bound :PORT. Production keeps the
	// fully graceful path via the shutdown hooks (the orchestrator sends SIGKILL if
	// shutdown overruns its grace period).
	const server = app.getHttpServer();
	for (const signal of ["SIGTERM", "SIGINT"] as const) {
		process.on(signal, () => {
			server.closeAllConnections?.();
			if (!config.isProduction) {
				setTimeout(() => process.exit(0), 1500).unref();
			}
		});
	}

	// The watcher can spawn the replacement before the old process has fully
	// released the port; retry on EADDRINUSE to ride out that brief overlap. In
	// production a genuinely occupied port still fails after the short window.
	for (let attempt = 1; ; attempt++) {
		try {
			await app.listen(port);
			break;
		} catch (err) {
			const code = (err as NodeJS.ErrnoException).code;
			if (code === "EADDRINUSE" && attempt <= 10) {
				logger.warn(
					`:${port} busy (predecessor still exiting), retry ${attempt}/10`,
					"Bootstrap",
				);
				await new Promise((resolve) => setTimeout(resolve, 300));
				continue;
			}
			throw err;
		}
	}
	logger.log(`Breakbeat HTTP service started on :${port}`, "Bootstrap");
}

bootstrap().catch((err) => {
	process.stderr.write(
		`HTTP bootstrap failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
	);
	process.exit(1);
});
