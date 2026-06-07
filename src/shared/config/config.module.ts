import { Global, Module } from "@nestjs/common";
import { ConfigModule as NestConfigModule } from "@nestjs/config";
import { AppConfigService } from "./app-config.service";
import { parseEnv } from "./env.schema";

@Global()
@Module({
	exports: [AppConfigService],
	imports: [
		NestConfigModule.forRoot({
			cache: true,
			isGlobal: true,
			validate: (raw) => {
				const { env, warnings } = parseEnv(raw);
				for (const w of warnings) {
					// Logger is not yet constructed at config-validation time.
					process.stdout.write(`[config] ${w}\n`);
				}
				return env;
			},
		}),
	],
	providers: [AppConfigService],
})
export class ConfigModule {}
