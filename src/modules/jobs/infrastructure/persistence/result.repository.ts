import { Inject, Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { DRIZZLE } from "../../../../shared/database/database.tokens";
import { results } from "../../../../shared/database/schema";
import { parseEnum, parseEnumOrNull } from "../../../../shared/util/parse-enum";
import { CONTENT_TYPES } from "../../domain/content-type";
import {
	CONFIDENCES,
	EXCLUSION_CODES,
	type Exclusion,
} from "../../domain/exclusion";
import type { ResultRepository } from "../../domain/ports/result-repository.port";
import { RESULT_STATUSES, Result, SENTIMENTS } from "../../domain/result";

type ResultRow = typeof results.$inferSelect;

// Validate DB text columns against their closed sets before narrowing — a
// corrupt/unexpected value fails fast rather than entering the domain via `as`.
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
			confidence: parseEnumOrNull(row.confidence, CONFIDENCES, "confidence"),
			contentType: parseEnumOrNull(
				row.contentType,
				CONTENT_TYPES,
				"content type",
			),
			exclusion: row.exclusionCode
				? {
						code: parseEnum(
							row.exclusionCode,
							EXCLUSION_CODES,
							"exclusion code",
						),
						detail: row.exclusionDetail,
					}
				: null,
			sentiment: parseEnumOrNull(row.sentiment, SENTIMENTS, "sentiment"),
			status: parseEnum(row.status, RESULT_STATUSES, "result status"),
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
