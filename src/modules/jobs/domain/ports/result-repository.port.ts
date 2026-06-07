import type { Exclusion } from "../exclusion";
import type { Result } from "../result";

export const RESULT_REPOSITORY = Symbol("RESULT_REPOSITORY");

export interface ResultRepository {
	/** Insert a Result; returns false if its (jobId, normalizedUrl) already exists. */
	insertIfNew(result: Result): Promise<boolean>;
	findIncludedByJob(jobId: string): Promise<Result[]>;
	findAllByJob(jobId: string): Promise<Result[]>;
	markExcluded(id: string, exclusion: Exclusion): Promise<void>;
}
