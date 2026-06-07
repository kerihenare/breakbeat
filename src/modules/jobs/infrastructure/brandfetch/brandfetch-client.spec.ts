import type { AppConfigService } from "../../../../shared/config/app-config.service";
import { BrandfetchClient } from "./brandfetch-client";

function configStub(
	values: Record<string, string | undefined>,
): AppConfigService {
	return {
		get: (key: string) => values[key],
		isProduction: false,
	} as unknown as AppConfigService;
}

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});

describe("BrandfetchClient", () => {
	it("is unconfigured and returns empty/null without keys", async () => {
		const client = new BrandfetchClient(configStub({}));
		expect(client.isConfigured()).toBe(false);
		expect(await client.search("acme")).toEqual([]);
		expect(await client.fetchProfile("acme.com")).toBeNull();
	});

	it("maps search results to candidates", async () => {
		globalThis.fetch = (async () =>
			({
				json: async () => [
					{ domain: "acme.com", icon: "https://logo/acme.png", name: "Acme" },
					{ domain: "acmefoods.com" },
				],
				ok: true,
			}) as unknown as Response) as typeof fetch;
		const client = new BrandfetchClient(
			configStub({ BRANDFETCH_API_KEY: "k", BRANDFETCH_CLIENT_ID: "c" }),
		);
		const out = await client.search("acme");
		expect(out).toEqual([
			{ domain: "acme.com", iconUrl: "https://logo/acme.png", name: "Acme" },
			{ domain: "acmefoods.com", iconUrl: null, name: "acmefoods.com" },
		]);
	});

	it("extracts social handles from brand profile links", async () => {
		globalThis.fetch = (async () =>
			({
				json: async () => ({
					domain: "acme.com",
					links: [
						{ name: "twitter", url: "https://x.com/acme" },
						{ name: "linkedin", url: "https://linkedin.com/company/acme" },
						{ name: "homepage", url: "https://acme.com" },
					],
					name: "Acme Inc",
				}),
				ok: true,
			}) as unknown as Response) as typeof fetch;
		const client = new BrandfetchClient(
			configStub({ BRANDFETCH_API_KEY: "k", BRANDFETCH_CLIENT_ID: "c" }),
		);
		const profile = await client.fetchProfile("acme.com");
		expect(profile?.handles).toEqual([
			"https://x.com/acme",
			"https://linkedin.com/company/acme",
		]);
	});

	it("degrades to [] on an HTTP error", async () => {
		globalThis.fetch = (async () =>
			({ ok: false, status: 500 }) as unknown as Response) as typeof fetch;
		const client = new BrandfetchClient(
			configStub({ BRANDFETCH_API_KEY: "k", BRANDFETCH_CLIENT_ID: "c" }),
		);
		expect(await client.search("acme")).toEqual([]);
	});
});
