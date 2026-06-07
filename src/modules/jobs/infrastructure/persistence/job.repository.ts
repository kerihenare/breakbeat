import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { DRIZZLE } from "../../../../shared/database/database.tokens";
import { jobs, warnings } from "../../../../shared/database/schema";
import { Job } from "../../domain/job";
import type { JobStatus } from "../../domain/job-status";
import type { JobRepository } from "../../domain/ports/job-repository.port";
import type { IdentityProvenance } from "../../domain/resolved-identity";

@Injectable()
export class DrizzleJobRepository implements JobRepository {
	constructor(@Inject(DRIZZLE) private readonly db: PostgresJsDatabase) {}

	async save(job: Job): Promise<void> {
		await this.db.transaction(async (tx) => {
			const row = {
				companyName: job.companyName,
				createdAt: job.createdAt,
				error: job.error,
				homepageUrl: job.homepageUrl,
				id: job.id,
				provenance: job.provenance,
				status: job.status,
				windowEnd: job.window.end,
				windowStart: job.window.start,
			};
			await tx
				.insert(jobs)
				.values(row)
				.onConflictDoUpdate({
					set: {
						companyName: row.companyName,
						error: row.error,
						homepageUrl: row.homepageUrl,
						provenance: row.provenance,
						status: row.status,
						windowEnd: row.windowEnd,
						windowStart: row.windowStart,
					},
					target: jobs.id,
				});
			// Warnings are append-only and small; re-sync the set on each save.
			await tx.delete(warnings).where(eq(warnings.jobId, job.id));
			if (job.warnings.length > 0) {
				await tx.insert(warnings).values(
					job.warnings.map((w) => ({
						id: randomUUID(),
						jobId: job.id,
						message: w.message,
					})),
				);
			}
		});
	}

	async findById(id: string): Promise<Job | null> {
		const [row] = await this.db
			.select()
			.from(jobs)
			.where(eq(jobs.id, id))
			.limit(1);
		if (!row) return null;
		const warningRows = await this.db
			.select()
			.from(warnings)
			.where(eq(warnings.jobId, id));
		return new Job(
			row.id,
			row.companyName,
			row.homepageUrl,
			{ end: row.windowEnd, start: row.windowStart },
			row.createdAt,
			{
				error: row.error,
				provenance: row.provenance as IdentityProvenance | null,
				status: row.status as JobStatus,
				warnings: warningRows.map((w) => ({ message: w.message })),
			},
		);
	}
}
