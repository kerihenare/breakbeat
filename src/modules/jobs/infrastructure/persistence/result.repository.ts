import { Inject, Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { DRIZZLE } from "../../../../shared/database/database.tokens";
import { results } from "../../../../shared/database/schema";
import type { ContentType } from "../../domain/content-type";
import type {
	Confidence,
	Exclusion,
	ExclusionCode,
} from "../../domain/exclusion";
import type { ResultRepository } from "../../domain/ports/result-repository.port";
import { Result, type ResultStatus, type Sentiment } from "../../domain/result";

type ResultRow = typeof results.$inferSelect;

function toDomain(row: ResultRow): Result {
	return new Result(
		row.id,
		row.jobId,
		row.url,
		row.normalizedUrl,
		row.title,
		row.sourceDomain,
		row.publishedDate,
		{
			confidence: row.confidence as Confidence | null,
			contentType: row.contentType as ContentType | null,
			exclusion: row.exclusionCode
				? {
						code: row.exclusionCode as ExclusionCode,
						detail: row.exclusionDetail,
					}
				: null,
			sentiment: row.sentiment as Sentiment | null,
			status: row.status as ResultStatus,
		},
	);
}

@Injectable()
export class DrizzleResultRepository implements ResultRepository {
	constructor(@Inject(DRIZZLE) private readonly db: PostgresJsDatabase) {}

	async insertIfNew(result: Result): Promise<boolean> {
		const inserted = await this.db
			.insert(results)
			.values({
				confidence: result.confidence,
				contentType: result.contentType,
				exclusionCode: result.exclusion?.code ?? null,
				exclusionDetail: result.exclusion?.detail ?? null,
				id: result.id,
				jobId: result.jobId,
				normalizedUrl: result.normalizedUrl,
				publishedDate: result.publishedDate,
				sentiment: result.sentiment,
				sourceDomain: result.sourceDomain,
				status: result.status,
				title: result.title,
				url: result.url,
			})
			.onConflictDoNothing({ target: [results.jobId, results.normalizedUrl] })
			.returning({ id: results.id });
		return inserted.length > 0;
	}

	async findIncludedByJob(jobId: string): Promise<Result[]> {
		const rows = await this.db
			.select()
			.from(results)
			.where(and(eq(results.jobId, jobId), eq(results.status, "included")));
		return rows.map(toDomain);
	}

	async findAllByJob(jobId: string): Promise<Result[]> {
		const rows = await this.db
			.select()
			.from(results)
			.where(eq(results.jobId, jobId));
		return rows.map(toDomain);
	}

	async markExcluded(id: string, exclusion: Exclusion): Promise<void> {
		await this.db
			.update(results)
			.set({
				exclusionCode: exclusion.code,
				exclusionDetail: exclusion.detail,
				status: "excluded",
			})
			.where(eq(results.id, id));
	}
}
