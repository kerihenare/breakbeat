import "./instrument";
import { NestFactory } from "@nestjs/core";
import { Logger } from "nestjs-pino";
import { WorkerModule } from "./worker.module";

async function bootstrap(): Promise<void> {
	const app = await NestFactory.createApplicationContext(WorkerModule, {
		bufferLogs: true,
	});
	app.useLogger(app.get(Logger));
	app.enableShutdownHooks();
	app
		.get(Logger)
		.log("Breakbeat worker started (pipeline processor)", "Worker");
}

bootstrap().catch((err) => {
	process.stderr.write(
		`Worker bootstrap failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
	);
	process.exit(1);
});
