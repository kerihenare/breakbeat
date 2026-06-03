import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { createDb } from "../db.ts";
import {
	addWarning,
	createQueue,
	TERMINAL_STATES,
	transition,
} from "./queue.ts";

// Helper: set up a company + job row, return jobId
function setupJob(db: ReturnType<typeof createDb>): number {
	db.prepare("INSERT INTO companies (name) VALUES (?)").run("Acme Corp");
	const company = db
		.prepare("SELECT id FROM companies WHERE name = ?")
		.get("Acme Corp") as { id: number };
	db.prepare("INSERT INTO jobs (company_id) VALUES (?)").run(company.id);
	const job = db
		.prepare("SELECT id FROM jobs WHERE company_id = ?")
		.get(company.id) as { id: number };
	return job.id;
}

function getJobStatus(db: ReturnType<typeof createDb>, jobId: number): string {
	const row = db
		.prepare("SELECT status, error FROM jobs WHERE id = ?")
		.get(jobId) as { status: string; error: string | null };
	return row.status;
}

function getJobError(
	db: ReturnType<typeof createDb>,
	jobId: number,
): string | null {
	const row = db.prepare("SELECT error FROM jobs WHERE id = ?").get(jobId) as {
		error: string | null;
	};
	return row.error;
}

function getWarnings(db: ReturnType<typeof createDb>, jobId: number): string[] {
	const rows = db
		.prepare("SELECT message FROM warnings WHERE job_id = ? ORDER BY id")
		.all(jobId) as { message: string }[];
	return rows.map((r) => r.message);
}

// ─── TERMINAL_STATES ─────────────────────────────────────────────────────────

describe("TERMINAL_STATES", () => {
	it("contains done, failed, done_with_warnings", () => {
		assert.ok(
			TERMINAL_STATES.has("done"),
			"TERMINAL_STATES must include 'done'",
		);
		assert.ok(
			TERMINAL_STATES.has("failed"),
			"TERMINAL_STATES must include 'failed'",
		);
		assert.ok(
			TERMINAL_STATES.has("done_with_warnings"),
			"TERMINAL_STATES must include 'done_with_warnings'",
		);
		assert.equal(TERMINAL_STATES.size, 3);
	});
});

// ─── transition() — legal edges ──────────────────────────────────────────────

describe("transition — legal edges walk the full pipeline", () => {
	it("walks pending → resolving → searching → filtering → classifying → done", () => {
		const db = createDb(":memory:");
		const jobId = setupJob(db);

		transition(db, jobId, "resolving");
		assert.equal(getJobStatus(db, jobId), "resolving");

		transition(db, jobId, "searching");
		assert.equal(getJobStatus(db, jobId), "searching");

		transition(db, jobId, "filtering");
		assert.equal(getJobStatus(db, jobId), "filtering");

		transition(db, jobId, "classifying");
		assert.equal(getJobStatus(db, jobId), "classifying");

		transition(db, jobId, "done");
		assert.equal(getJobStatus(db, jobId), "done");
		db.close();
	});

	it("walks classifying → done_with_warnings", () => {
		const db = createDb(":memory:");
		const jobId = setupJob(db);
		transition(db, jobId, "resolving");
		transition(db, jobId, "searching");
		transition(db, jobId, "filtering");
		transition(db, jobId, "classifying");
		transition(db, jobId, "done_with_warnings");
		assert.equal(getJobStatus(db, jobId), "done_with_warnings");
		db.close();
	});
});

// ─── transition() — failed is reachable from every non-terminal state ─────────

describe("transition — failed reachable from every non-terminal state", () => {
	const nonTerminalStates = [
		"pending",
		"resolving",
		"searching",
		"filtering",
		"classifying",
	] as const;

	for (const fromState of nonTerminalStates) {
		it(`fails from ${fromState} with a human-readable message`, () => {
			const db = createDb(":memory:");
			const jobId = setupJob(db);

			// Advance to the desired from-state (pending is already the initial state)
			const stepsTo: Record<string, string[]> = {
				classifying: ["resolving", "searching", "filtering", "classifying"],
				filtering: ["resolving", "searching", "filtering"],
				pending: [],
				resolving: ["resolving"],
				searching: ["resolving", "searching"],
			};
			for (const step of stepsTo[fromState]) {
				transition(db, jobId, step as Parameters<typeof transition>[2]);
			}

			const msg = `Stage ${fromState} exploded`;
			transition(db, jobId, "failed", msg);
			assert.equal(getJobStatus(db, jobId), "failed");
			assert.equal(getJobError(db, jobId), msg);
			db.close();
		});
	}
});

// ─── transition() — illegal jumps ────────────────────────────────────────────

describe("transition — illegal jumps throw and leave status untouched", () => {
	it("throws on pending → done (skipping stages)", () => {
		const db = createDb(":memory:");
		const jobId = setupJob(db);
		assert.throws(() => transition(db, jobId, "done"), /illegal transition/i);
		assert.equal(getJobStatus(db, jobId), "pending");
		db.close();
	});

	it("throws on pending → classifying (skipping stages)", () => {
		const db = createDb(":memory:");
		const jobId = setupJob(db);
		assert.throws(
			() => transition(db, jobId, "classifying"),
			/illegal transition/i,
		);
		assert.equal(getJobStatus(db, jobId), "pending");
		db.close();
	});

	it("throws on resolving → done (skipping stages)", () => {
		const db = createDb(":memory:");
		const jobId = setupJob(db);
		transition(db, jobId, "resolving");
		assert.throws(() => transition(db, jobId, "done"), /illegal transition/i);
		assert.equal(getJobStatus(db, jobId), "resolving");
		db.close();
	});

	it("throws on done → done_with_warnings (no outgoing edges from terminal)", () => {
		const db = createDb(":memory:");
		const jobId = setupJob(db);
		transition(db, jobId, "resolving");
		transition(db, jobId, "searching");
		transition(db, jobId, "filtering");
		transition(db, jobId, "classifying");
		transition(db, jobId, "done");
		assert.throws(
			() => transition(db, jobId, "done_with_warnings"),
			/illegal transition/i,
		);
		assert.equal(getJobStatus(db, jobId), "done");
		db.close();
	});
});

// ─── transition() — terminal states accept no further transitions ─────────────

describe("transition — terminal states accept no further transitions", () => {
	it("done is terminal — no further transitions allowed", () => {
		const db = createDb(":memory:");
		const jobId = setupJob(db);
		transition(db, jobId, "resolving");
		transition(db, jobId, "searching");
		transition(db, jobId, "filtering");
		transition(db, jobId, "classifying");
		transition(db, jobId, "done");

		assert.throws(() => transition(db, jobId, "failed"), /illegal transition/i);
		assert.equal(getJobStatus(db, jobId), "done");
		db.close();
	});

	it("failed is terminal — no further transitions allowed", () => {
		const db = createDb(":memory:");
		const jobId = setupJob(db);
		transition(db, jobId, "failed", "boom");
		assert.throws(
			() => transition(db, jobId, "resolving"),
			/illegal transition/i,
		);
		assert.equal(getJobStatus(db, jobId), "failed");
		db.close();
	});

	it("done_with_warnings is terminal — no further transitions allowed", () => {
		const db = createDb(":memory:");
		const jobId = setupJob(db);
		transition(db, jobId, "resolving");
		transition(db, jobId, "searching");
		transition(db, jobId, "filtering");
		transition(db, jobId, "classifying");
		transition(db, jobId, "done_with_warnings");
		assert.throws(() => transition(db, jobId, "done"), /illegal transition/i);
		assert.equal(getJobStatus(db, jobId), "done_with_warnings");
		db.close();
	});
});

// ─── addWarning() ─────────────────────────────────────────────────────────────

describe("addWarning", () => {
	it("appends a warning to the job's warning list", () => {
		const db = createDb(":memory:");
		const jobId = setupJob(db);
		addWarning(db, jobId, "first warning");
		const warnings = getWarnings(db, jobId);
		assert.equal(warnings.length, 1);
		assert.equal(warnings[0], "first warning");
		db.close();
	});

	it("appends multiple warnings in order", () => {
		const db = createDb(":memory:");
		const jobId = setupJob(db);
		addWarning(db, jobId, "alpha");
		addWarning(db, jobId, "beta");
		addWarning(db, jobId, "gamma");
		const warnings = getWarnings(db, jobId);
		assert.deepEqual(warnings, ["alpha", "beta", "gamma"]);
		db.close();
	});

	it("warnings from different jobs are independent", () => {
		const db = createDb(":memory:");
		const jobId1 = setupJob(db);
		// insert a second company+job
		db.prepare("INSERT INTO companies (name) VALUES (?)").run("Beta Corp");
		const company2 = db
			.prepare("SELECT id FROM companies WHERE name = ?")
			.get("Beta Corp") as { id: number };
		db.prepare("INSERT INTO jobs (company_id) VALUES (?)").run(company2.id);
		const job2 = db
			.prepare("SELECT id FROM jobs WHERE company_id = ?")
			.get(company2.id) as { id: number };

		addWarning(db, jobId1, "job1 warning");
		addWarning(db, job2.id, "job2 warning");

		assert.deepEqual(getWarnings(db, jobId1), ["job1 warning"]);
		assert.deepEqual(getWarnings(db, job2.id), ["job2 warning"]);
		db.close();
	});
});

// ─── createQueue() — FIFO, concurrency 1 ─────────────────────────────────────

describe("createQueue — FIFO with concurrency 1", () => {
	it("runs jobs strictly FIFO: job 2 waits for job 1 to finish", async () => {
		const order: number[] = [];
		let resolveJob1: (() => void) | null = null;

		// Runner captures completion order; job 1 is gated by a manual resolver
		const runner = async (jobId: number): Promise<void> => {
			if (jobId === 1) {
				await new Promise<void>((resolve) => {
					resolveJob1 = resolve;
				});
			}
			order.push(jobId);
		};

		const queue = createQueue(runner);

		const p1 = queue.enqueue(1);
		const p2 = queue.enqueue(2);

		// Give the event loop a tick so job1 starts running
		await new Promise((r) => setImmediate(r));

		// job2 must NOT have started yet (job1 is still blocked)
		assert.deepEqual(order, [], "job2 must not start before job1 completes");

		// Unblock job1
		resolveJob1?.();
		await Promise.all([p1, p2]);

		// Job 1 must finish before job 2 starts
		assert.deepEqual(order, [1, 2], "jobs must complete in FIFO order");
	});

	it("job 2 starts only after job 1 resolves", async () => {
		const started: number[] = [];
		const finished: number[] = [];

		const runner = async (jobId: number): Promise<void> => {
			started.push(jobId);
			// Tiny async gap to confirm concurrency
			await new Promise((r) => setImmediate(r));
			finished.push(jobId);
		};

		const queue = createQueue(runner);
		const p1 = queue.enqueue(10);
		const p2 = queue.enqueue(20);

		await Promise.all([p1, p2]);

		assert.deepEqual(started, [10, 20]);
		assert.deepEqual(finished, [10, 20]);
	});
});

// ─── createQueue() — throwing runner doesn't kill the queue ──────────────────

describe("createQueue — throwing runner does not kill the queue", () => {
	it("job 3 still runs when jobs 1 and 2 throw", async () => {
		const ran: number[] = [];

		const runner = async (jobId: number): Promise<void> => {
			if (jobId === 1 || jobId === 2) {
				throw new Error(`job ${jobId} failed`);
			}
			ran.push(jobId);
		};

		const queue = createQueue(runner);
		const p1 = queue.enqueue(1);
		const p2 = queue.enqueue(2);
		const p3 = queue.enqueue(3);

		// All enqueue promises settle (queue must not propagate the throw)
		await Promise.all([p1, p2, p3]);

		assert.deepEqual(ran, [3], "job 3 must run after jobs 1 and 2 throw");
	});

	it("queue continues processing after a mid-queue throw", async () => {
		const ran: number[] = [];

		const runner = async (jobId: number): Promise<void> => {
			if (jobId === 2) throw new Error("job 2 failed");
			ran.push(jobId);
		};

		const queue = createQueue(runner);
		await Promise.all([queue.enqueue(1), queue.enqueue(2), queue.enqueue(3)]);

		assert.deepEqual(ran, [1, 3]);
	});
});
