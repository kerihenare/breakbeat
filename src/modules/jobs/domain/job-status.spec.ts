import {
	assertTransition,
	canTransition,
	isTerminal,
	TERMINAL_STATES,
} from "./job-status";

describe("job-status", () => {
	it("allows the happy-path pipeline edges", () => {
		expect(canTransition("pending", "resolving")).toBe(true);
		expect(canTransition("resolving", "searching")).toBe(true);
		expect(canTransition("searching", "filtering")).toBe(true);
		expect(canTransition("filtering", "classifying")).toBe(true);
		expect(canTransition("classifying", "done")).toBe(true);
		expect(canTransition("classifying", "done_with_warnings")).toBe(true);
	});

	it("allows failing from any non-terminal state", () => {
		for (const s of [
			"pending",
			"resolving",
			"searching",
			"filtering",
			"classifying",
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
