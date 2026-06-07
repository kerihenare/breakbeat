import {
	Body,
	Controller,
	Get,
	Inject,
	Param,
	Post,
	Req,
	Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { ViewRenderer } from "../../../shared/view/view-renderer";
import { SubmitJob } from "../application/submit-job.use-case";
import type { Job } from "../domain/job";
import {
	JOB_REPOSITORY,
	type JobRepository,
} from "../domain/ports/job-repository.port";
import {
	RESULT_REPOSITORY,
	type ResultRepository,
} from "../domain/ports/result-repository.port";
import { buildJobView } from "./view-model";

type RecentRow = {
	id: string;
	companyName: string;
	status: string;
};

function toRecent(job: Job): RecentRow {
	return { companyName: job.companyName, id: job.id, status: job.status };
}

function isHtmx(req: Request): boolean {
	return req.headers["hx-request"] === "true";
}

@Controller()
export class JobsController {
	constructor(
		private readonly submitJob: SubmitJob,
		private readonly view: ViewRenderer,
		@Inject(JOB_REPOSITORY) private readonly jobs: JobRepository,
		@Inject(RESULT_REPOSITORY) private readonly results: ResultRepository,
	) {}

	@Get()
	async home(@Res() res: Response): Promise<void> {
		const recent = await this.jobs.listRecent(20);
		res
			.type("html")
			.send(this.view.render("home.njk", { recent: recent.map(toRecent) }));
	}

	@Post("jobs")
	async create(
		@Body() body: { companyName?: string; homepageUrl?: string },
		@Req() req: Request,
		@Res() res: Response,
	): Promise<void> {
		const job = await this.submitJob.execute({
			companyName: body.companyName ?? "",
			homepageUrl: body.homepageUrl ?? null,
		});
		if (isHtmx(req)) {
			const view = buildJobView(job, []);
			res.type("html").send(this.view.render("_job_live.njk", { view }));
			return;
		}
		res.redirect(303, `/jobs/${job.id}`);
	}

	@Get("jobs/:id")
	async show(
		@Param("id") id: string,
		@Req() req: Request,
		@Res() res: Response,
	): Promise<void> {
		const job = await this.jobs.findById(id);
		if (!job) {
			res.status(404).type("html").send(this.view.render("404.njk"));
			return;
		}
		const results = await this.results.findAllByJob(id);
		const view = buildJobView(job, results);
		const template = isHtmx(req) ? "_job_live.njk" : "job.njk";
		res.type("html").send(this.view.render(template, { view }));
	}
}
