import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { SentryGlobalFilter, SentryModule } from "@sentry/nestjs/setup";
import { CoreModule } from "./core.module";
import { DebugModule } from "./modules/debug/debug.module";
import { HealthModule } from "./modules/health/health.module";

@Module({
	imports: [SentryModule.forRoot(), CoreModule, HealthModule, DebugModule],
	providers: [{ provide: APP_FILTER, useClass: SentryGlobalFilter }],
})
export class AppModule {}
