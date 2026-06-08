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

describe("buildJobView verificationStatus", () => {
	it("surfaces verificationStatus on an included result marked uncertain", () => {
		const window = { end: "2026-06-08", start: "2023-06-08" };
		const job = new Job("j2", "Acme", null, window, new Date(), {
			status: "done",
		});
		const uncertain = new Result(
			"c",
			"j2",
			"https://x/c",
			"x/c",
			"Maybe Acme",
			"x",
			"2025-03-01",
			null,
			null,
			{ confidence: "high", contentType: "news" },
		);
		uncertain.setVerification("uncertain");
		const view = buildJobView(job, [uncertain]);
		const item = view.groups[0].items[0];
		expect(item.verificationStatus).toBe("uncertain");
	});

	it("off_topic exclusion group carries label 'Off topic'", () => {
		const window = { end: "2026-06-08", start: "2023-06-08" };
		const job = new Job("j3", "Acme", null, window, new Date(), {
			status: "done",
		});
		const offTopic = new Result(
			"d",
			"j3",
			"https://acmefoods.com/news",
			"acmefoods.com/news",
			"Acme Foods product recall",
			"acmefoods.com",
			"2025-09-12",
			null,
			null,
			{ exclusion: { code: "off_topic", detail: "LLM" }, status: "excluded" },
		);
		const view = buildJobView(job, [offTopic]);
		const group = view.excluded.find((g) => g.code === "off_topic");
		expect(group?.label).toBe("Off topic");
	});
});
