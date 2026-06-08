import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { desc, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { DRIZZLE } from "../../../../shared/database/database.tokens";
import { jobs, warnings } from "../../../../shared/database/schema";
import { parseEnum, parseEnumOrNull } from "../../../../shared/util/parse-enum";
import { Job } from "../../domain/job";
import { JOB_STATUSES } from "../../domain/job-status";
import type { JobRepository } from "../../domain/ports/job-repository.port";
import { IDENTITY_PROVENANCES } from "../../domain/resolved-identity";

@Injectable()
export class DrizzleJobRepository implements JobRepository {
	constructor(@Inject(DRIZZLE) private readonly db: PostgresJsDatabase) {}

	async save(job: Job): Promise<void> {
		await this.db.transaction(async (tx) => {
			const row = {
				brandContext: job.resolvedIdentity?.context ?? null,
				chosenDomain: job.chosenDomain,
				companyName: job.companyName,
				contextNote: job.contextNote,
				createdAt: job.createdAt,
				error: job.error,
				homepageUrl: job.homepageUrl,
				id: job.id,
				negativeMatches: job.resolvedIdentity?.negativeMatches ?? null,
				provenance: job.provenance,
				resolvedDomains: job.resolvedIdentity?.domains ?? null,
				resolvedHandles: job.resolvedIdentity?.handles ?? null,
				status: job.status,
				windowEnd: job.window.end,
				windowStart: job.window.start,
			};
			await tx
				.insert(jobs)
				.values(row)
				.onConflictDoUpdate({
					set: {
						brandContext: row.brandContext,
						chosenDomain: row.chosenDomain,
						companyName: row.companyName,
						contextNote: row.contextNote,
						error: row.error,
						homepageUrl: row.homepageUrl,
						negativeMatches: row.negativeMatches,
						provenance: row.provenance,
						resolvedDomains: row.resolvedDomains,
						resolvedHandles: row.resolvedHandles,
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
				chosenDomain: row.chosenDomain,
				contextNote: row.contextNote,
				error: row.error,
				provenance: parseEnumOrNull(
					row.provenance,
					IDENTITY_PROVENANCES,
					"provenance",
				),
				resolvedIdentity:
					row.resolvedDomains !== null
						? {
								context: row.brandContext ?? null,
								domains: row.resolvedDomains,
								handles: row.resolvedHandles ?? [],
								name: row.companyName,
								negativeMatches: row.negativeMatches ?? [],
								provenance:
									parseEnumOrNull(
										row.provenance,
										IDENTITY_PROVENANCES,
										"provenance",
									) ?? "none",
								window: { end: row.windowEnd, start: row.windowStart },
							}
						: null,
				status: parseEnum(row.status, JOB_STATUSES, "job status"),
				warnings: warningRows.map((w) => ({ message: w.message })),
			},
		);
	}

	async listRecent(limit: number): Promise<Job[]> {
		const safeLimit = Math.min(Math.max(1, Math.floor(limit) || 1), 100);
		const rows = await this.db
			.select()
			.from(jobs)
			.orderBy(desc(jobs.createdAt))
			.limit(safeLimit);
		// Recent-list view doesn't need each job's warnings (avoids an N+1); the
		// full page (findById) loads them.
		return rows.map(
			(row) =>
				new Job(
					row.id,
					row.companyName,
					row.homepageUrl,
					{ end: row.windowEnd, start: row.windowStart },
					row.createdAt,
					{
						error: row.error,
						provenance: parseEnumOrNull(
							row.provenance,
							IDENTITY_PROVENANCES,
							"provenance",
						),
						status: parseEnum(row.status, JOB_STATUSES, "job status"),
					},
				),
		);
	}
}
