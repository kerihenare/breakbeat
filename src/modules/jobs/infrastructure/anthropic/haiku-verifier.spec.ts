import { AppConfigService } from "../../../../shared/config/app-config.service";
import type { ResolvedIdentity } from "../../domain/resolved-identity";
import { HaikuVerifier } from "./haiku-verifier";

const identity: ResolvedIdentity = {
	domains: [],
	handles: [],
	name: "Acme",
	negativeMatches: [],
	provenance: "none",
	window: { end: "2026-06-08", start: "2023-06-08" },
};

function config(key: string | undefined): AppConfigService {
	return {
		get: (k: string) => (k === "ANTHROPIC_API_KEY" ? key : ""),
	} as unknown as AppConfigService;
}

describe("HaikuVerifier", () => {
	it("is unconfigured without a key", () => {
		expect(new HaikuVerifier(config(undefined)).isConfigured()).toBe(false);
	});
	it("returns [] when unconfigured", async () => {
		const out = await new HaikuVerifier(config(undefined)).verify(
			[
				{
					id: "a",
					snippet: null,
					sourceDomain: "n",
					title: "T",
					url: "https://n/a",
				},
			],
			identity,
		);
		expect(out).toEqual([]);
	});
});
