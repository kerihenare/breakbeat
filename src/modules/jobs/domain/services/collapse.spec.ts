import { type CollapseInput, collapse } from "./collapse";

const LONG = "Acme raises a giant funding round this year"; // ≥25 chars normalized

function row(
	id: string,
	title: string,
	publishedDate: string | null,
): CollapseInput {
	return { id, publishedDate, title };
}

describe("collapse", () => {
	it("ignores titles shorter than 25 normalized chars", () => {
		const out = collapse([
			row("a", "Short bit", "2025-01-01"),
			row("b", "Short bit", "2025-01-02"),
		]);
		expect(out).toEqual([]);
	});

	it("collapses same-title copies within 14 days to the earliest, marking losers", () => {
		const out = collapse([
			row("late", LONG, "2025-01-10"),
			row("early", LONG, "2025-01-01"),
		]);
		expect(out).toEqual([{ loserId: "late", winnerId: "early" }]);
	});

	it("does not collapse the same title published more than 14 days apart", () => {
		const out = collapse([
			row("a", LONG, "2025-01-01"),
			row("b", LONG, "2025-03-01"),
		]);
		expect(out).toEqual([]);
	});

	it("lets an undated copy join a single dated cluster (winner = dated anchor)", () => {
		const out = collapse([
			row("dated", LONG, "2025-01-01"),
			row("undated", LONG, null),
		]);
		expect(out).toEqual([{ loserId: "undated", winnerId: "dated" }]);
	});

	it("keeps an undated copy when there are ≥2 dated clusters (ambiguous)", () => {
		const out = collapse([
			row("c1", LONG, "2025-01-01"),
			row("c2", LONG, "2025-06-01"),
			row("u", LONG, null),
		]);
		// two singleton dated clusters → no dated losers; undated stays included
		expect(out).toEqual([]);
	});

	it("collapses an all-undated group to the first-seen copy", () => {
		const out = collapse([row("first", LONG, null), row("second", LONG, null)]);
		expect(out).toEqual([{ loserId: "second", winnerId: "first" }]);
	});
});
