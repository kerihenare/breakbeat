import { Controller, Get, Inject, Param, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { ViewRenderer } from "../../../shared/view/view-renderer";
import { JOB_EVENTS, type JobEvents } from "../domain/ports/job-events.port";
import {
	JOB_REPOSITORY,
	type JobRepository,
} from "../domain/ports/job-repository.port";
import {
	RESULT_REPOSITORY,
	type ResultRepository,
} from "../domain/ports/result-repository.port";
import { buildJobView } from "./view-model";

function writeSse(res: Response, event: string, data: string): void {
	const lines = data.split("\n").map((line) => `data: ${line}`);
	res.write(`event: ${event}\n${lines.join("\n")}\n\n`);
}

@Controller()
export class JobEventsController {
	constructor(
		private readonly view: ViewRenderer,
		@Inject(JOB_EVENTS) private readonly events: JobEvents,
		@Inject(JOB_REPOSITORY) private readonly jobs: JobRepository,
		@Inject(RESULT_REPOSITORY) private readonly results: ResultRepository,
	) {}

	@Get("jobs/:id/events")
	async stream(
		@Param("id") id: string,
		@Req() req: Request,
		@Res() res: Response,
	): Promise<void> {
		res.set({
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
			"Content-Type": "text/event-stream",
			"X-Accel-Buffering": "no",
		});
		res.flushHeaders();

		let closed = false;
		const finish = async (unsub?: () => Promise<void>): Promise<void> => {
			if (closed) return;
			closed = true;
			if (unsub) await unsub();
		};

		const sendUpdate = async (): Promise<void> => {
			if (closed) return;
			const job = await this.jobs.findById(id);
			if (!job) {
				writeSse(res, "done", "1");
				res.end();
				closed = true;
				return;
			}
			const results = await this.results.findAllByJob(id);
			writeSse(
				res,
				"message",
				this.view.render("_job_pane.njk", { view: buildJobView(job, results) }),
			);
			if (job.isTerminal) {
				writeSse(res, "done", "1");
				res.end();
				closed = true;
			}
		};

		const unsubscribe = await this.events.subscribe(id, () => {
			void sendUpdate();
		});
		req.on("close", () => {
			void finish(unsubscribe);
		});

		// Emit current state immediately (covers an already-terminal job).
		await sendUpdate();
		if (closed) await finish(unsubscribe);
	}
}
