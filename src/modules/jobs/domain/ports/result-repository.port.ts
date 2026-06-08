import type { ContentType } from "../content-type";
import type { Confidence, Exclusion } from "../exclusion";
import type { Result, VerificationStatus } from "../result";

export const RESULT_REPOSITORY = Symbol("RESULT_REPOSITORY");

export interface ResultRepository {
	/** Insert a Result; returns false if its (jobId, normalizedUrl) already exists. */
	insertIfNew(result: Result): Promise<boolean>;
	findIncludedByJob(jobId: string): Promise<Result[]>;
	findAllByJob(jobId: string): Promise<Result[]>;
	markExcluded(id: string, exclusion: Exclusion): Promise<void>;
	markClassified(
		id: string,
		contentType: ContentType | null,
		confidence: Confidence,
	): Promise<void>;
	setVerification(id: string, status: VerificationStatus): Promise<void>;
}
