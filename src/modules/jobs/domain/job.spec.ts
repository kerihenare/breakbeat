import { Job } from "./job";

const window = { end: "2026-06-08", start: "2023-06-08" };

function jobAt(
	status: Parameters<Job["transitionTo"]>[0] | undefined = undefined,
): Job {
	return new Job(
		"j1",
		"Acme",
		"https://acme.com",
		window,
		new Date("2026-06-08T00:00:00Z"),
		{
			status: status ?? "classifying",
		},
	);
}

describe("Job", () => {
	it("finalizes to done when there are no warnings", () => {
		const job = jobAt();
		job.finalize();
		expect(job.status).toBe("done");
	});

	it("finalizes to done_with_warnings when a warning was recorded", () => {
		const job = jobAt();
		job.addWarning("3 of 18 queries failed");
		job.finalize();
		expect(job.status).toBe("done_with_warnings");
		expect(job.warnings).toHaveLength(1);
	});

	it("records the error message when transitioning to failed", () => {
		const job = jobAt("searching");
		job.transitionTo("failed", "all queries failed");
		expect(job.status).toBe("failed");
		expect(job.error).toBe("all queries failed");
	});

	it("rejects an illegal transition", () => {
		const job = new Job("j2", "Acme", null, window, new Date(), {
			status: "pending",
		});
		expect(() => job.transitionTo("done")).toThrow(/illegal transition/);
	});
});
