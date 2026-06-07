import "./instrument";
import { NestFactory } from "@nestjs/core";
import { Logger } from "nestjs-pino";
import { AppModule } from "./app.module";
import { AppConfigService } from "./shared/config/app-config.service";

async function bootstrap(): Promise<void> {
	const app = await NestFactory.create(AppModule, { bufferLogs: true });
	app.useLogger(app.get(Logger));
	app.enableShutdownHooks();
	const config = app.get(AppConfigService);
	const port = config.get("PORT");
	await app.listen(port);
	app
		.get(Logger)
		.log(`Breakbeat HTTP service started on :${port}`, "Bootstrap");
}

bootstrap().catch((err) => {
	process.stderr.write(
		`HTTP bootstrap failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
	);
	process.exit(1);
});
