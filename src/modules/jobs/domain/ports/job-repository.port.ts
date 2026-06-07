import type { Job } from "../job";

export const JOB_REPOSITORY = Symbol("JOB_REPOSITORY");

export interface JobRepository {
	save(job: Job): Promise<void>;
	findById(id: string): Promise<Job | null>;
	listRecent(limit: number): Promise<Job[]>;
}
