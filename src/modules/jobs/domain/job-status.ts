// Job state machine — pure. Ported from v1 (src/jobs/queue.ts), decoupled from
// persistence: the legal-edges table lives here; writing the new status is the
// repository's job.

export type JobStatus =
	| "pending"
	| "resolving"
	| "searching"
	| "filtering"
	| "classifying"
	| "done"
	| "failed"
	| "done_with_warnings";

/** Terminal states — no outgoing edges. */
export const TERMINAL_STATES: ReadonlySet<JobStatus> = new Set([
	"done",
	"failed",
	"done_with_warnings",
]);

/** Maps every non-terminal state to its valid successor states. */
const LEGAL_EDGES: ReadonlyMap<JobStatus, ReadonlySet<JobStatus>> = new Map([
	["pending", new Set<JobStatus>(["resolving", "failed"])],
	["resolving", new Set<JobStatus>(["searching", "failed"])],
	["searching", new Set<JobStatus>(["filtering", "failed"])],
	["filtering", new Set<JobStatus>(["classifying", "failed"])],
	["classifying", new Set<JobStatus>(["done", "done_with_warnings", "failed"])],
]);

export function isTerminal(status: JobStatus): boolean {
	return TERMINAL_STATES.has(status);
}

export function canTransition(from: JobStatus, to: JobStatus): boolean {
	return LEGAL_EDGES.get(from)?.has(to) ?? false;
}

/** Throws `illegal transition: <from> → <to>` if the edge is not legal. */
export function assertTransition(from: JobStatus, to: JobStatus): void {
	if (!canTransition(from, to)) {
		throw new Error(`illegal transition: ${from} → ${to}`);
	}
}
