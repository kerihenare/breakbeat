import { computeWindow } from "./window";

describe("computeWindow", () => {
	it("computes a 36-month window ending today (date-only, UTC)", () => {
		const now = new Date("2026-06-08T13:45:00Z");
		expect(computeWindow(now)).toEqual({
			end: "2026-06-08",
			start: "2023-06-08",
		});
	});

	it("ignores the time component", () => {
		const a = computeWindow(new Date("2025-01-15T00:00:01Z"));
		const b = computeWindow(new Date("2025-01-15T23:59:59Z"));
		expect(a).toEqual(b);
		expect(a.end).toBe("2025-01-15");
		expect(a.start).toBe("2022-01-15");
	});
});
