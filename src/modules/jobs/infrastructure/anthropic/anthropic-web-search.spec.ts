import { AppConfigService } from "../../../../shared/config/app-config.service";
import { AnthropicWebSearch } from "./anthropic-web-search";

function config(key: string | undefined): AppConfigService {
	return {
		get: (k: string) => (k === "ANTHROPIC_API_KEY" ? key : ""),
	} as unknown as AppConfigService;
}

describe("AnthropicWebSearch", () => {
	it("is unconfigured without a key", () => {
		expect(new AnthropicWebSearch(config(undefined)).isConfigured()).toBe(
			false,
		);
	});
	it("returns [] when unconfigured", async () => {
		expect(
			await new AnthropicWebSearch(config(undefined)).search("anything"),
		).toEqual([]);
	});
});
