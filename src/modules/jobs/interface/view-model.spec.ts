import { Job } from "../domain/job";
import { Result } from "../domain/result";
import { buildJobView, mockSentiment } from "./view-model";

describe("mockSentiment", () => {
	it("is deterministic for a given id", () => {
		expect(mockSentiment("abc")).toBe(mockSentiment("abc"));
	});
	it("only returns the three sentiment values", () => {
		const seen = new Set([
			mockSentiment("1"),
			mockSentiment("2"),
			mockSentiment("3"),
			mockSentiment("x"),
		]);
		for (const s of seen)
			expect(["positive", "neutral", "negative"]).toContain(s);
	});
});

describe("buildJobView sentiment", () => {
	it("aggregates mock sentiment only over included results", () => {
		const window = { end: "2026-06-08", start: "2023-06-08" };
		const job = new Job("j1", "Acme", null, window, new Date(), {
			status: "done",
		});
		const included = new Result(
			"a",
			"j1",
			"https://x/a",
			"x/a",
			"T",
			"x",
			"2025-01-01",
			null,
			{ confidence: "high", contentType: "news" },
		);
		const excluded = new Result(
			"b",
			"j1",
			"https://x/b",
			"x/b",
			"T2",
			"x",
			"2025-01-01",
			null,
			{ exclusion: { code: "aggregator", detail: null }, status: "excluded" },
		);
		const view = buildJobView(job, [included, excluded]);
		const total =
			view.sentiment.positive +
			view.sentiment.neutral +
			view.sentiment.negative;
		expect(total).toBe(1); // only the included result is counted
	});
});
