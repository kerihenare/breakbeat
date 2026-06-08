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
	BRAND_DIRECTORY,
	type BrandDirectory,
} from "../domain/ports/brand-directory.port";
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
	createdAt: string;
};

/** Mono-friendly `YYYY-MM-DD HH:mm` stamp; lets two same-name runs be told apart. */
function formatStamp(d: Date): string {
	const iso = d.toISOString();
	return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

function toRecent(job: Job): RecentRow {
	return {
		companyName: job.companyName,
		createdAt: formatStamp(job.createdAt),
		id: job.id,
		status: job.status,
	};
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
		@Inject(BRAND_DIRECTORY) private readonly brands: BrandDirectory,
	) {}

	private async submitAndRespond(
		input: {
			companyName: string;
			homepageUrl: string | null;
			chosenDomain?: string | null;
		},
		req: Request,
		res: Response,
	): Promise<void> {
		const job = await this.submitJob.execute(input);
		if (isHtmx(req)) {
			res
				.type("html")
				.send(
					this.view.render("_job_live.njk", { view: buildJobView(job, []) }),
				);
			return;
		}
		res.redirect(303, `/jobs/${job.id}`);
	}

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
		const companyName = (body.companyName ?? "").trim();
		const homepageUrl = body.homepageUrl?.trim()
			? body.homepageUrl.trim()
			: null;

		// A URL is the disambiguator — submit straight away. Name-only goes
		// through BrandFetch disambiguation when it's configured and finds
		// candidates; otherwise it degrades to a name-only submission.
		if (!homepageUrl && companyName && this.brands.isConfigured()) {
			const candidates = await this.brands.search(companyName);
			if (candidates.length > 0) {
				const html = this.view.render("_brand_candidates.njk", {
					candidates,
					companyName,
				});
				res.type("html").send(html);
				return;
			}
		}
		await this.submitAndRespond({ companyName, homepageUrl }, req, res);
	}

	@Post("jobs/select")
	async select(
		@Body() body: { companyName?: string; domain?: string },
		@Req() req: Request,
		@Res() res: Response,
	): Promise<void> {
		await this.submitAndRespond(
			{
				chosenDomain: body.domain ?? null,
				companyName: (body.companyName ?? "").trim(),
				homepageUrl: null,
			},
			req,
			res,
		);
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
		// HTMX swaps only the pane; a full page load also needs the rail's
		// recent-jobs history so the job page is the same surface as home.
		if (isHtmx(req)) {
			res.type("html").send(this.view.render("_job_live.njk", { view }));
			return;
		}
		const recent = await this.jobs.listRecent(20);
		res
			.type("html")
			.send(
				this.view.render("job.njk", { recent: recent.map(toRecent), view }),
			);
	}
}
