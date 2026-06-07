export const JOB_EVENTS = Symbol("JOB_EVENTS");

/**
 * Cross-process nudge that a Job changed. Carries no payload — subscribers
 * re-read the Job from the source of truth (the DB). The worker publishes;
 * the HTTP SSE endpoint subscribes.
 */
export interface JobEvents {
	publish(jobId: string): Promise<void>;
	/** Returns an unsubscribe function. */
	subscribe(jobId: string, onEvent: () => void): Promise<() => Promise<void>>;
}
