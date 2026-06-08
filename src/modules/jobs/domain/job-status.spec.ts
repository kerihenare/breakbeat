import {
	assertTransition,
	canTransition,
	isTerminal,
	JOB_STATUSES,
	TERMINAL_STATES,
} from "./job-status";

describe("job-status", () => {
	it("allows the happy-path pipeline edges", () => {
		expect(canTransition("pending", "resolving")).toBe(true);
		expect(canTransition("resolving", "searching")).toBe(true);
		expect(canTransition("searching", "filtering")).toBe(true);
		expect(canTransition("filtering", "verifying")).toBe(true);
		expect(canTransition("verifying", "classifying")).toBe(true);
		expect(canTransition("classifying", "extracting")).toBe(true);
		expect(canTransition("extracting", "refining")).toBe(true);
		expect(canTransition("refining", "done")).toBe(true);
		expect(canTransition("refining", "done_with_warnings")).toBe(true);
	});

	it("allows the Classify sub-phases to short-circuit to a terminal when work is skipped", () => {
		// extractor unconfigured → stay in classifying → finalize
		expect(canTransition("classifying", "done")).toBe(true);
		expect(canTransition("classifying", "done_with_warnings")).toBe(true);
		// extracted but no content to re-classify → extracting → finalize
		expect(canTransition("extracting", "done")).toBe(true);
		expect(canTransition("extracting", "done_with_warnings")).toBe(true);
	});

	it("allows failing from any non-terminal state", () => {
		for (const s of [
			"pending",
			"resolving",
			"searching",
			"filtering",
			"verifying",
			"classifying",
			"extracting",
			"refining",
		] as const) {
			expect(canTransition(s, "failed")).toBe(true);
		}
	});

	it("rejects skipping stages and any edge out of a terminal state", () => {
		expect(canTransition("pending", "searching")).toBe(false);
		expect(canTransition("done", "resolving")).toBe(false);
		expect(canTransition("failed", "pending")).toBe(false);
	});

	it("assertTransition throws on an illegal edge with both states named", () => {
		expect(() => assertTransition("pending", "done")).toThrow(
			/illegal transition: pending → done/,
		);
	});

	it("identifies terminal states", () => {
		expect(isTerminal("done")).toBe(true);
		expect(isTerminal("done_with_warnings")).toBe(true);
		expect(isTerminal("failed")).toBe(true);
		expect(isTerminal("pending")).toBe(false);
		expect(TERMINAL_STATES.size).toBe(3);
	});
});

describe("verifying status", () => {
	it("is a known status", () => {
		expect(JOB_STATUSES).toContain("verifying");
	});
	it("sits between filtering and classifying", () => {
		expect(canTransition("filtering", "verifying")).toBe(true);
		expect(canTransition("verifying", "classifying")).toBe(true);
		expect(canTransition("filtering", "classifying")).toBe(false);
	});
	it("can short-circuit to a terminal", () => {
		expect(canTransition("verifying", "done_with_warnings")).toBe(true);
		expect(canTransition("verifying", "failed")).toBe(true);
	});
});
