import type { DatabaseSync } from "node:sqlite";
import type { Request, Response } from "express";
import { Router } from "express";
import { normalizeHost } from "../filter/normalize.ts";
import { findOrCreateCompany } from "./company.ts";

// ─── Validation helpers ────────────────────────────────────────────────────

const NAME_MAX = 200;

function validateName(raw: string | undefined): string | null {
	if (raw === undefined || raw === null) return null;
	const trimmed = raw.trim();
	if (trimmed.length === 0) return null;
	if (trimmed.length > NAME_MAX) return null;
	return trimmed;
}

function validateUrl(raw: string | undefined): string | null {
	if (raw === undefined || raw === null) return null;
	const trimmed = raw.trim();
	if (trimmed.length === 0) return null;
	try {
		const parsed = new URL(trimmed);
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
			return null;
		}
		return trimmed;
	} catch {
		return null;
	}
}

// ─── Types ─────────────────────────────────────────────────────────────────

type JobListRow = {
	id: number;
	company_name: string;
	status: string;
	included_count: number;
	created_at: string;
};

type JobRow = {
	id: number;
	company_id: number;
	status: string;
	created_at: string;
	error: string | null;
};

type ResultRow = {
	id: number;
	url: string;
	title: string;
	snippet: string | null;
	source_domain: string;
	published_date: string | null;
	status: string;
	exclusion_code: string | null;
	exclusion_detail: string | null;
	content_type: string | null;
	confidence: string | null;
};

// ─── Router factory ────────────────────────────────────────────────────────

export function createJobsRouter(
	db: DatabaseSync,
	enqueue: (jobId: number) => void,
) {
	const router = Router();

	// ─── GET / ────────────────────────────────────────────────────────────────

	router.get("/", (_req: Request, res: Response) => {
		const jobs = db
			.prepare(
				`SELECT
           j.id,
           c.name AS company_name,
           j.status,
           j.created_at,
           (SELECT COUNT(*) FROM results r WHERE r.job_id = j.id AND r.status = 'included') AS included_count
         FROM jobs j
         JOIN companies c ON c.id = j.company_id
         ORDER BY j.created_at DESC`,
			)
			.all() as JobListRow[];

		res.render("index.njk", { jobs });
	});

	// ─── POST / ───────────────────────────────────────────────────────────────

	router.post("/", (req: Request, res: Response) => {
		const rawName = req.body?.name as string | undefined;
		const rawUrl = req.body?.url as string | undefined;

		const validName = validateName(rawName);
		const validUrl = validateUrl(rawUrl);

		// At least one of name or URL must be present
		if (validName === null && validUrl === null) {
			res.render("index.njk", {
				error:
					"Please provide a company name and/or URL (provide the URL for unambiguous results).",
				fields: { name: rawName ?? "", url: rawUrl ?? "" },
				jobs: getJobsList(db),
			});
			return;
		}

		// If only URL provided, derive name from host
		let displayName = validName;
		if (displayName === null && validUrl !== null) {
			displayName = normalizeHost(validUrl);
		}

		// By this point displayName is non-null (either from input or derived from URL)
		const company = findOrCreateCompany(
			db,
			displayName as string,
			validUrl ?? undefined,
		);

		// Insert pending job
		db.prepare("INSERT INTO jobs (company_id) VALUES (?)").run(company.id);
		const jobRow = db
			.prepare("SELECT id FROM jobs WHERE id = last_insert_rowid()")
			.get() as { id: number };
		const jobId = jobRow.id;

		// Enqueue background processing
		enqueue(jobId);

		// PRG redirect
		res.redirect(303, `/${jobId}`);
	});

	// ─── GET /:id ────────────────────────────────────────────────────────────

	router.get("/:id", (req: Request, res: Response) => {
		const id = Number(req.params.id);
		if (!Number.isInteger(id) || id <= 0) {
			res.status(404).render("404.njk", { message: "Job not found" });
			return;
		}

		const job = db
			.prepare(
				`SELECT j.*, c.name AS company_name
         FROM jobs j
         JOIN companies c ON c.id = j.company_id
         WHERE j.id = ?`,
			)
			.get(id) as (JobRow & { company_name: string }) | undefined;

		if (!job) {
			res.status(404).render("404.njk", { message: "Job not found" });
			return;
		}

		const warningCount = (
			db
				.prepare("SELECT COUNT(*) as n FROM warnings WHERE job_id = ?")
				.get(id) as { n: number }
		).n;

		const includedCount = (
			db
				.prepare(
					"SELECT COUNT(*) as n FROM results WHERE job_id = ? AND status = 'included'",
				)
				.get(id) as { n: number }
		).n;

		const excludedCount = (
			db
				.prepare(
					"SELECT COUNT(*) as n FROM results WHERE job_id = ? AND status = 'excluded'",
				)
				.get(id) as { n: number }
		).n;

		const results = db
			.prepare(
				`SELECT * FROM results WHERE job_id = ? ORDER BY published_date DESC, created_at DESC`,
			)
			.all(id) as ResultRow[];

		const data = {
			excludedCount,
			includedCount,
			job,
			results,
			warningCount,
		};

		// Two render depths: HTMX fragment vs full page
		const isHtmx = req.headers["hx-request"] === "true";
		if (isHtmx) {
			res.render("_job.njk", data);
		} else {
			res.render("job.njk", data);
		}
	});

	return router;
}

// ─── helpers ──────────────────────────────────────────────────────────────

function getJobsList(db: DatabaseSync): JobListRow[] {
	return db
		.prepare(
			`SELECT
       j.id,
       c.name AS company_name,
       j.status,
       j.created_at,
       (SELECT COUNT(*) FROM results r WHERE r.job_id = j.id AND r.status = 'included') AS included_count
     FROM jobs j
     JOIN companies c ON c.id = j.company_id
     ORDER BY j.created_at DESC`,
		)
		.all() as JobListRow[];
}
