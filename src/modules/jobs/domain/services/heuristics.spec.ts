import type { ResolvedIdentity } from "../resolved-identity";
import { type HeuristicInput, heuristicExclusion } from "./heuristics";

const identity: ResolvedIdentity = {
	domains: ["acme.com"],
	handles: ["https://x.com/acme"],
	name: "Acme",
	negativeMatches: [],
	provenance: "url_provided",
	window: { end: "2026-06-08", start: "2023-06-08" },
};
const windowStart = new Date("2023-06-08T00:00:00Z");

function input(p: Partial<HeuristicInput>): HeuristicInput {
	return {
		publishedDate: "2025-01-01",
		sourceDomain: "example.com",
		title: "A perfectly ordinary news story about the company",
		url: "https://example.com/story",
		...p,
	};
}

describe("heuristicExclusion", () => {
	it("excludes own domain and subdomains as own_channel", () => {
		expect(
			heuristicExclusion(
				input({ sourceDomain: "acme.com" }),
				identity,
				windowStart,
			),
		).toEqual({
			code: "own_channel",
			detail: "acme.com",
		});
		expect(
			heuristicExclusion(
				input({ sourceDomain: "blog.acme.com" }),
				identity,
				windowStart,
			)?.code,
		).toBe("own_channel");
	});

	it("does not exclude a look-alike domain", () => {
		expect(
			heuristicExclusion(
				input({ sourceDomain: "notacme.com" }),
				identity,
				windowStart,
			),
		).toBeNull();
	});

	it("excludes an own social handle URL as own_channel", () => {
		const r = heuristicExclusion(
			input({ sourceDomain: "x.com", url: "https://x.com/acme/status/123" }),
			identity,
			windowStart,
		);
		expect(r?.code).toBe("own_channel");
	});

	it("excludes aggregators", () => {
		expect(
			heuristicExclusion(
				input({ sourceDomain: "reddit.com" }),
				identity,
				windowStart,
			)?.code,
		).toBe("aggregator");
	});

	it("excludes data-aggregator profile sites as aggregator", () => {
		for (const sourceDomain of [
			"crunchbase.com",
			"pitchbook.com",
			"dealroom.co",
			"tracxn.com",
		]) {
			expect(
				heuristicExclusion(input({ sourceDomain }), identity, windowStart)
					?.code,
			).toBe("aggregator");
		}
	});

	it("excludes review domains, ecommerce paths, and ecommerce titles", () => {
		expect(
			heuristicExclusion(
				input({ sourceDomain: "g2.com" }),
				identity,
				windowStart,
			)?.code,
		).toBe("ecommerce_review");
		expect(
			heuristicExclusion(
				input({ url: "https://shop.example.com/buy/widget" }),
				identity,
				windowStart,
			)?.code,
		).toBe("ecommerce_review");
		expect(
			heuristicExclusion(
				input({ title: "Best Acme alternatives and tools" }),
				identity,
				windowStart,
			)?.code,
		).toBe("ecommerce_review");
	});

	it("does not treat 'vs' in a title as ecommerce (path-only)", () => {
		expect(
			heuristicExclusion(
				input({ title: "Acme vs the regulators: a fight" }),
				identity,
				windowStart,
			),
		).toBeNull();
	});

	it("excludes out-of-window dates but keeps dateless results", () => {
		expect(
			heuristicExclusion(
				input({ publishedDate: "2020-01-01" }),
				identity,
				windowStart,
			)?.code,
		).toBe("out_of_window");
		expect(
			heuristicExclusion(input({ publishedDate: null }), identity, windowStart),
		).toBeNull();
	});
});
