import type { ResolvedIdentity } from "../resolved-identity";
import { buildVerifyPrompt, VERIFY_RESPONSE_SCHEMA } from "./verify-prompt";

const identity: ResolvedIdentity = {
	context: {
		aliases: [],
		description: "A fintech payments company.",
		industry: "Fintech",
	},
	domains: ["acme.com"],
	handles: [],
	name: "Acme",
	negativeMatches: ["acmefoods.com"],
	provenance: "url_provided",
	window: { end: "2026-06-08", start: "2023-06-08" },
};

describe("buildVerifyPrompt", () => {
	it("states the brand context and the disambiguation question", () => {
		const prompt = buildVerifyPrompt(
			[
				{
					id: "a",
					snippet: "Acme launches new card",
					sourceDomain: "n",
					title: "T",
					url: "https://n/a",
				},
			],
			identity,
		);
		expect(prompt).toContain("A fintech payments company.");
		expect(prompt).toContain("acmefoods.com");
		expect(prompt).toContain("id: a");
	});
	it("exposes a closed-enum schema (match/mismatch/uncertain, high/low)", () => {
		const decision =
			VERIFY_RESPONSE_SCHEMA.properties.results.items.properties.decision.enum;
		expect(decision).toEqual(["match", "mismatch", "uncertain"]);
	});
});
