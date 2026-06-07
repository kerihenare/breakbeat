import {
	Controller,
	ForbiddenException,
	Get,
	Inject,
	Res,
} from "@nestjs/common";
import type { Response } from "express";
import { AppConfigService } from "../../../shared/config/app-config.service";
import { CLOCK, type Clock } from "../domain/ports/clock.port";
import {
	ID_GENERATOR,
	type IdGenerator,
} from "../domain/ports/id-generator.port";
import {
	JOB_REPOSITORY,
	type JobRepository,
} from "../domain/ports/job-repository.port";
import {
	RESULT_REPOSITORY,
	type ResultRepository,
} from "../domain/ports/result-repository.port";
import { buildDemoJob } from "./demo-fixtures";

/** Dev-only: seed a finished demo Job so the Clipping Desk is viewable without keys. */
@Controller("demo")
export class DemoController {
	constructor(
		private readonly config: AppConfigService,
		@Inject(JOB_REPOSITORY) private readonly jobs: JobRepository,
		@Inject(RESULT_REPOSITORY) private readonly results: ResultRepository,
		@Inject(ID_GENERATOR) private readonly ids: IdGenerator,
		@Inject(CLOCK) private readonly clock: Clock,
	) {}

	@Get()
	async seed(@Res() res: Response): Promise<void> {
		if (this.config.isProduction) {
			throw new ForbiddenException("demo seed is disabled in production");
		}
		const { job, results } = buildDemoJob(this.ids, this.clock);
		await this.jobs.save(job);
		for (const r of results) await this.results.insertIfNew(r);
		res.redirect(303, `/jobs/${job.id}`);
	}
}
