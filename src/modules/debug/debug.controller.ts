import { Controller, ForbiddenException, Get } from "@nestjs/common";
import { AppConfigService } from "../../shared/config/app-config.service";

@Controller("debug")
export class DebugController {
	constructor(private readonly config: AppConfigService) {}

	// Verification aid for Bugsink capture. Guarded off in production.
	@Get("error")
	boom(): never {
		if (this.config.isProduction) {
			throw new ForbiddenException("disabled in production");
		}
		throw new Error("Breakbeat debug error — verifying error capture");
	}
}
