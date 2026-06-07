export const JOB_QUEUE = Symbol("JOB_QUEUE");

export interface JobQueue {
	/** Enqueue a persisted Job for background processing. */
	enqueue(jobId: string): Promise<void>;
}
