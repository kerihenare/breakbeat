import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { Module } from "@nestjs/common";
import { LoggerModule } from "nestjs-pino";
import { AppConfigService } from "../config/app-config.service";
import { ConfigModule } from "../config/config.module";

@Module({
	imports: [
		LoggerModule.forRootAsync({
			imports: [ConfigModule],
			inject: [AppConfigService],
			useFactory: (config: AppConfigService) => {
				const vlUrl = config.get("VICTORIALOGS_URL");
				// stdout is the source of truth; VictoriaLogs is an attached target.
				const stdout = { options: { destination: 1 }, target: "pino/file" };
				const targets = vlUrl
					? [
							stdout,
							{
								options: { url: vlUrl },
								target: require.resolve("./victoria-logs.transport"),
							},
						]
					: [stdout];
				return {
					pinoHttp: {
						autoLogging: true,
						base: { service: "breakbeat" },
						genReqId: (req: IncomingMessage) => {
							const header = req.headers["x-request-id"];
							return (
								(Array.isArray(header) ? header[0] : header) ?? randomUUID()
							);
						},
						timestamp: () => `,"time":${Date.now()}`,
						transport: { targets },
					},
				};
			},
		}),
	],
})
export class LoggingModule {}
