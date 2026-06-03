import type { DatabaseSync } from "node:sqlite";

// ─── Job status types ─────────────────────────────────────────────────────────

type JobStatus =
	| "pending"
	| "resolving"
	| "searching"
	| "filtering"
	| "classifying"
	| "done"
	| "failed"
	| "done_with_warnings";

// ─── TERMINAL_STATES ─────────────────────────────────────────────────────────

/**
 * Terminal states — no outgoing edges. Once a job reaches one of these states,
 * no further transitions are legal.
 */
export const TERMINAL_STATES: ReadonlySet<string> = new Set<string>([
	"done",
	"failed",
	"done_with_warnings",
]);

// ─── Legal-edges table ────────────────────────────────────────────────────────
//
// Maps every non-terminal state to its valid successor states.
// Terminal states have no entry — any transition from them is illegal.
//
//   pending     → resolving | failed
//   resolving   → searching | failed
//   searching   → filtering | failed
//   filtering   → classifying | failed
//   classifying → done | done_with_warnings | failed
//   done, failed, done_with_warnings → ∅  (terminal)

const LEGAL_EDGES: ReadonlyMap<string, ReadonlySet<string>> = new Map([
	["pending", new Set(["resolving", "failed"])],
	["resolving", new Set(["searching", "failed"])],
	["searching", new Set(["filtering", "failed"])],
	["filtering", new Set(["classifying", "failed"])],
	["classifying", new Set(["done", "done_with_warnings", "failed"])],
]);

// ─── transition() ─────────────────────────────────────────────────────────────

/**
 * Validate and apply a job-status transition.
 *
 * Reads the current status from the DB, checks it against the legal-edges
 * table, and — only if the transition is legal — writes the new status.
 *
 * When transitioning to `failed`, the optional `message` is stored on the job
 * row as the human-readable `error` field.
 *
 * Throws with "illegal transition: <from> → <to>" if the transition is not in
 * the legal-edges table, leaving the DB row untouched.
 */
export function transition(
	db: DatabaseSync,
	jobId: number,
	toState: JobStatus,
	message?: string,
): void {
	const row = db.prepare("SELECT status FROM jobs WHERE id = ?").get(jobId) as
		| { status: string }
		| undefined;

	if (!row) {
		throw new Error(`job not found: ${jobId}`);
	}

	const fromState = row.status;
	const allowedNext = LEGAL_EDGES.get(fromState);

	if (!allowedNext?.has(toState)) {
		throw new Error(`illegal transition: ${fromState} → ${toState}`);
	}

	if (toState === "failed") {
		db.prepare("UPDATE jobs SET status = ?, error = ? WHERE id = ?").run(
			toState,
			message ?? null,
			jobId,
		);
	} else {
		db.prepare("UPDATE jobs SET status = ? WHERE id = ?").run(toState, jobId);
	}
}

// ─── addWarning() ─────────────────────────────────────────────────────────────

/**
 * Append a Warning row to the job's warning list.
 */
export function addWarning(
	db: DatabaseSync,
	jobId: number,
	message: string,
): void {
	db.prepare("INSERT INTO warnings (job_id, message) VALUES (?, ?)").run(
		jobId,
		message,
	);
}

// ─── createQueue() ────────────────────────────────────────────────────────────

/**
 * Create an in-process FIFO queue with concurrency 1.
 *
 * The runner is injected so this module stays dependency-free and testable.
 * A throwing runner is caught and swallowed — subsequent jobs still run.
 *
 * Returns `{ enqueue(jobId) }` — enqueue returns a Promise that resolves when
 * the job's runner call settles (whether it resolved or threw). The promise
 * never rejects: errors from the runner are swallowed so the queue never dies.
 */
export function createQueue(run: (jobId: number) => Promise<void>): {
	enqueue: (jobId: number) => Promise<void>;
} {
	// tail is the "end" of the chain — we serialise by chaining onto it.
	let tail: Promise<void> = Promise.resolve();

	function enqueue(jobId: number): Promise<void> {
		// Attach this job to the end of the current chain.
		// We capture the returned promise so callers can await settlement.
		const jobPromise = tail.then(() =>
			// Wrap the runner so a throw never breaks the chain.
			run(jobId).catch(() => {
				// Swallow — the queue must survive a throwing runner.
			}),
		);

		// Advance the tail. Use the caught version so the chain never rejects.
		tail = jobPromise;

		return jobPromise;
	}

	return { enqueue };
}
