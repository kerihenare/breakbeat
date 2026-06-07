import type { ResolvedIdentity } from "../resolved-identity";
import {
	buildClassifyPrompt,
	type ClassifyInput,
	type ClassifyVerdictRaw,
	validateResultIds,
} from "./classify-prompt";

const identity: ResolvedIdentity = {
	domains: ["acme.com"],
	handles: ["https://x.com/acme"],
	name: "Acme",
	negativeMatches: ["acmefoods.com"],
	provenance: "url_provided",
	window: { end: "2026-06-08", start: "2023-06-08" },
};

const inputs: ClassifyInput[] = [
	{
		content: "body",
		id: "r1",
		sourceDomain: "n",
		title: "Acme news",
		url: "https://n/1",
	},
];

describe("buildClassifyPrompt", () => {
	const prompt = buildClassifyPrompt(inputs, identity);
	it("includes identity, own domains, negative matches, and each result id", () => {
		expect(prompt).toContain("Company name: Acme");
		expect(prompt).toContain("acme.com");
		expect(prompt).toContain("acmefoods.com");
		expect(prompt).toContain("id: r1");
		expect(prompt).toContain("Acme news");
	});
});

describe("validateResultIds", () => {
	const v = (id: string): ClassifyVerdictRaw => ({
		confidence: "high",
		content_type: "news",
		exclude: "none",
		id,
	});

	it("keeps valid ids, drops rogue, reports missing, dedupes", () => {
		const sent = new Set(["a", "b", "c"]);
		const { valid, rogue, missing } = validateResultIds(sent, [
			v("a"),
			v("a"), // dup → ignored
			v("z"), // rogue
			v("b"),
		]);
		expect(valid.map((x) => x.id)).toEqual(["a", "b"]);
		expect(rogue).toEqual(["z"]);
		expect(missing).toEqual(["c"]);
	});
});
