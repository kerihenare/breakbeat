// Job state machine — pure. Ported from v1 (src/jobs/queue.ts), decoupled from
// persistence: the legal-edges table lives here; writing the new status is the
// repository's job.

export type JobStatus =
	| "pending"
	| "resolving"
	| "searching"
	| "filtering"
	| "classifying"
	| "extracting"
	| "refining"
	| "done"
	| "failed"
	| "done_with_warnings";

export const JOB_STATUSES: readonly JobStatus[] = [
	"pending",
	"resolving",
	"searching",
	"filtering",
	"classifying",
	"extracting",
	"refining",
	"done",
	"failed",
	"done_with_warnings",
];

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
	// Classify runs as three sub-phases (snippet triage → Extract survivors →
	// full-text refine). Each can short-circuit to a terminal when its work is
	// skipped: no extractor → classifying finalizes; nothing extracted →
	// extracting finalizes.
	[
		"classifying",
		new Set<JobStatus>(["extracting", "done", "done_with_warnings", "failed"]),
	],
	[
		"extracting",
		new Set<JobStatus>(["refining", "done", "done_with_warnings", "failed"]),
	],
	["refining", new Set<JobStatus>(["done", "done_with_warnings", "failed"])],
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
