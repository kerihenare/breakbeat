import { Job } from "../domain/job";
import type {
	BrandDirectory,
	BrandProfile,
} from "../domain/ports/brand-directory.port";
import type { ContextHit, WebContext } from "../domain/ports/web-context.port";
import { ResolveStage } from "./resolve-stage";

const WINDOW = { end: "2026-06-08", start: "2023-06-08" };

function makeJob(name: string, chosenDomain: string | null): Job {
	return new Job("j1", name, null, WINDOW, new Date("2026-06-08T00:00:00Z"), {
		chosenDomain,
	});
}

function brandStub(over: Partial<BrandDirectory>): BrandDirectory {
	return {
		fetchContext: async () => null,
		fetchProfile: async () => null,
		isConfigured: () => true,
		search: async () => [],
		...over,
	};
}

function webStub(over: Partial<WebContext>): WebContext {
	return { isConfigured: () => false, search: async () => [], ...over };
}

describe("ResolveStage", () => {
	it("builds the identity from a brand profile and collects negative matches", async () => {
		const profile: BrandProfile = {
			domain: "acme.com",
			handles: ["https://x.com/acme"],
			name: "Acme Inc",
		};
		const brands = brandStub({
			fetchProfile: async () => profile,
			search: async () => [
				{ domain: "acme.com", iconUrl: null, name: "Acme" },
				{ domain: "acmefoods.com", iconUrl: null, name: "Acme Foods" },
			],
		});
		const stage = new ResolveStage(brands, webStub({}));
		const job = makeJob("Acme", "acme.com");

		await stage.run(job);

		expect(job.resolvedIdentity?.domains).toContain("acme.com");
		expect(job.resolvedIdentity?.handles).toContain("https://x.com/acme");
		expect(job.resolvedIdentity?.provenance).toBe("url_provided");
		expect(job.provenance).toBe("url_provided");
		expect(job.resolvedIdentity?.negativeMatches).toContain("acmefoods.com");
		expect(job.resolvedIdentity?.negativeMatches).not.toContain("acme.com");
	});

	it("degrades with a warning when no domain is known", async () => {
		const stage = new ResolveStage(
			brandStub({ isConfigured: () => false }),
			webStub({}),
		);
		const job = makeJob("Mystery Co", null);

		await stage.run(job);

		expect(job.resolvedIdentity?.provenance).toBe("none");
		expect(job.resolvedIdentity?.domains).toEqual([]);
		expect(
			job.warnings.some((w) => w.message.includes("no homepage identified")),
		).toBe(true);
	});

	it("warns and proceeds with the domain when the brand profile is unavailable", async () => {
		const stage = new ResolveStage(
			brandStub({ fetchProfile: async () => null }),
			webStub({}),
		);
		const job = makeJob("Acme", "acme.com");

		await stage.run(job);

		expect(job.resolvedIdentity?.domains).toEqual(["acme.com"]);
		expect(job.warnings.some((w) => w.message.includes("brand profile"))).toBe(
			true,
		);
	});

	it("captures Google context when configured", async () => {
		const hits: ContextHit[] = [
			{ title: "Acme raises funding", url: "https://news.example/acme" },
		];
		const stage = new ResolveStage(
			brandStub({ isConfigured: () => false }),
			webStub({ isConfigured: () => true, search: async () => hits }),
		);
		const job = makeJob("Acme", "acme.com");

		await stage.run(job);

		expect(job.contextNote).toContain("Acme raises funding");
	});

	it("attaches the brand context to the Resolved Identity", async () => {
		const profile: BrandProfile = {
			domain: "devtools.io",
			handles: [],
			name: "DevTools",
		};
		const brands = brandStub({
			fetchContext: async () => ({
				aliases: [],
				description: "A dev tools company.",
				industry: "Software",
			}),
			fetchProfile: async () => profile,
			search: async () => [],
		});
		const job = new Job(
			"j2",
			"DevTools",
			"https://devtools.io",
			WINDOW,
			new Date("2026-06-08T00:00:00Z"),
		);

		await new ResolveStage(brands, webStub({})).run(job);

		expect(job.resolvedIdentity?.context?.description).toBe(
			"A dev tools company.",
		);
	});

	it("warns when brand context is unavailable", async () => {
		const profile: BrandProfile = {
			domain: "devtools.io",
			handles: [],
			name: "DevTools",
		};
		const brands = brandStub({
			fetchContext: async () => null,
			fetchProfile: async () => profile,
			search: async () => [],
		});
		const job = new Job(
			"j3",
			"DevTools",
			"https://devtools.io",
			WINDOW,
			new Date("2026-06-08T00:00:00Z"),
		);

		await new ResolveStage(brands, webStub({})).run(job);

		expect(job.warnings.some((w) => /brand context/i.test(w.message))).toBe(
			true,
		);
		expect(job.resolvedIdentity?.context == null).toBe(true);
	});
});
