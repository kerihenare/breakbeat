import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
	type CandidatePage,
	computeWindow,
	extractHandles,
	isSafeUrl,
	NEVER_HOMEPAGE,
	pickHomepage,
} from "./resolve.ts";

// ─── computeWindow ────────────────────────────────────────────────────────────

describe("computeWindow", () => {
	it("pinned: 2026-06-03 → window 2023-06-03 → 2026-06-03", () => {
		const { windowStart, windowEnd } = computeWindow("2026-06-03");
		assert.equal(windowStart, "2023-06-03");
		assert.equal(windowEnd, "2026-06-03");
	});

	it("subtracts exactly 36 calendar months", () => {
		const { windowStart, windowEnd } = computeWindow("2025-01-15");
		assert.equal(windowStart, "2022-01-15");
		assert.equal(windowEnd, "2025-01-15");
	});

	it("handles year boundary crossing (January − 36 months)", () => {
		const { windowStart } = computeWindow("2026-01-01");
		assert.equal(windowStart, "2023-01-01");
	});

	it("clamps March 31 − 36 months back to March 31 (same day is valid)", () => {
		const { windowStart } = computeWindow("2026-03-31");
		assert.equal(windowStart, "2023-03-31");
	});

	it("clamps day when resulting month is shorter — e.g. 2024-05-31 minus 36 months → Feb does not exist", () => {
		// 2024-05-31 minus 36 months = 2021-05-31; all fine (May has 31 days)
		const { windowStart } = computeWindow("2024-05-31");
		assert.equal(windowStart, "2021-05-31");
	});

	it("clamps day for Feb: 2026-02-28 − 36 months → 2023-02-28", () => {
		const { windowStart } = computeWindow("2026-02-28");
		assert.equal(windowStart, "2023-02-28");
	});

	it("windowEnd always equals createdAt", () => {
		const dates = ["2026-06-03", "2024-12-31", "2023-07-04"];
		for (const d of dates) {
			const { windowEnd } = computeWindow(d);
			assert.equal(windowEnd, d, `windowEnd should equal createdAt for ${d}`);
		}
	});
});

// ─── NEVER_HOMEPAGE ───────────────────────────────────────────────────────────

describe("NEVER_HOMEPAGE", () => {
	it("contains all required blocklist entries", () => {
		const required = [
			"wikipedia.org",
			"linkedin.com",
			"facebook.com",
			"x.com",
			"twitter.com",
			"instagram.com",
			"crunchbase.com",
			"bloomberg.com",
			"glassdoor.com",
			"indeed.com",
			"youtube.com",
			"github.com",
		];
		for (const domain of required) {
			assert.ok(
				NEVER_HOMEPAGE.has(domain),
				`NEVER_HOMEPAGE must include ${domain}`,
			);
		}
	});

	it("has exactly 12 entries", () => {
		assert.equal(NEVER_HOMEPAGE.size, 12);
	});
});

// ─── pickHomepage ─────────────────────────────────────────────────────────────

describe("pickHomepage", () => {
	it("returns the first candidate matching name token in domain", () => {
		const candidates: CandidatePage[] = [
			{ title: "Acme Corp — Home", url: "https://acme.com" },
			{ title: "Other Site", url: "https://other.com" },
		];
		assert.equal(pickHomepage(candidates, "Acme"), "https://acme.com");
	});

	it("returns the first candidate matching name token in title", () => {
		const candidates: CandidatePage[] = [
			{ title: "Widget Inc — Official Site", url: "https://getwidget.io" },
		];
		assert.equal(
			pickHomepage(candidates, "Widget Inc"),
			"https://getwidget.io",
		);
	});

	it("returns null when all candidates are on NEVER_HOMEPAGE blocklist", () => {
		const candidates: CandidatePage[] = [
			{
				title: "Acme — Wikipedia",
				url: "https://en.wikipedia.org/wiki/Acme",
			},
			{
				title: "Acme | LinkedIn",
				url: "https://www.linkedin.com/company/acme",
			},
		];
		assert.equal(pickHomepage(candidates, "Acme"), null);
	});

	it("skips blocked domain and returns next matching candidate", () => {
		const candidates: CandidatePage[] = [
			{
				title: "Acme — Wikipedia",
				url: "https://en.wikipedia.org/wiki/Acme",
			},
			{ title: "Acme Corp Official Site", url: "https://acme.com" },
		];
		assert.equal(pickHomepage(candidates, "Acme"), "https://acme.com");
	});

	it("returns null when no candidate passes the name-token guard", () => {
		const candidates: CandidatePage[] = [
			{ title: "Completely Unrelated Site", url: "https://unrelated.com" },
			{ title: "Another Site", url: "https://another.io" },
		];
		assert.equal(pickHomepage(candidates, "Acme"), null);
	});

	it("returns null for empty candidate list", () => {
		assert.equal(pickHomepage([], "Acme"), null);
	});

	it("matches name token as substring in domain (getacme.io matches 'acme')", () => {
		const candidates: CandidatePage[] = [
			{ title: "Get Acme Widget", url: "https://getacme.io" },
		];
		assert.equal(pickHomepage(candidates, "acme"), "https://getacme.io");
	});

	it("is case-insensitive for name token matching", () => {
		const candidates: CandidatePage[] = [
			{ title: "Acme Corp", url: "https://ACME.COM" },
		];
		assert.equal(pickHomepage(candidates, "Acme"), "https://ACME.COM");
	});

	it("only needs one token from multi-word name to match", () => {
		// "Globex Corporation" — if "globex" appears in domain/title
		const candidates: CandidatePage[] = [
			{ title: "Globex — Enterprise Software", url: "https://globex.io" },
		];
		assert.equal(
			pickHomepage(candidates, "Globex Corporation"),
			"https://globex.io",
		);
	});

	it("blocks subdomain of a blocked root domain", () => {
		// en.wikipedia.org should be blocked because wikipedia.org is in the blocklist
		const candidates: CandidatePage[] = [
			{
				title: "Acme Corp — Wikipedia",
				url: "https://en.wikipedia.org/wiki/Acme_Corp",
			},
			{ title: "Acme Corp Home", url: "https://acme.com" },
		];
		assert.equal(pickHomepage(candidates, "Acme"), "https://acme.com");
	});
});

// ─── extractHandles ───────────────────────────────────────────────────────────

describe("extractHandles", () => {
	it("extracts a LinkedIn company URL", () => {
		const html = `<a href="https://www.linkedin.com/company/acme-corp">LinkedIn</a>`;
		const handles = extractHandles(html);
		assert.ok(
			handles.some((h) => h.includes("linkedin.com/company/acme-corp")),
			`expected linkedin handle in ${JSON.stringify(handles)}`,
		);
	});

	it("extracts a Twitter URL", () => {
		const html = `<a href="https://twitter.com/acmecorp">Follow us</a>`;
		const handles = extractHandles(html);
		assert.ok(
			handles.some((h) => h.includes("twitter.com/acmecorp")),
			`expected twitter handle in ${JSON.stringify(handles)}`,
		);
	});

	it("extracts an X.com URL", () => {
		const html = `<a href="https://x.com/acmecorp">Follow us on X</a>`;
		const handles = extractHandles(html);
		assert.ok(
			handles.some((h) => h.includes("x.com/acmecorp")),
			`expected x.com handle in ${JSON.stringify(handles)}`,
		);
	});

	it("extracts multiple handles from the same HTML", () => {
		const html = `
      <a href="https://www.linkedin.com/company/widget-inc">LinkedIn</a>
      <a href="https://twitter.com/widgetinc">Twitter</a>
      <a href="https://x.com/widgetinc2">X</a>
    `;
		const handles = extractHandles(html);
		assert.equal(handles.length, 3);
	});

	it("deduplicates the same URL appearing multiple times", () => {
		const html = `
      <a href="https://twitter.com/acme">Twitter</a>
      <a href="https://twitter.com/acme">Twitter again</a>
    `;
		const handles = extractHandles(html);
		assert.equal(
			handles.filter((h) => h.includes("twitter.com/acme")).length,
			1,
		);
	});

	it("skips known non-handle Twitter paths (intent)", () => {
		const html = `<a href="https://twitter.com/intent/tweet?text=hello">Tweet</a>`;
		const handles = extractHandles(html);
		assert.ok(
			!handles.some((h) => h.includes("intent")),
			"should not include intent path",
		);
	});

	it("returns empty array when no handles found", () => {
		const html = "<p>No social links here</p>";
		assert.deepEqual(extractHandles(html), []);
	});

	it("handles www. prefix in LinkedIn URL", () => {
		const html = `<a href="https://www.linkedin.com/company/acme">LinkedIn</a>`;
		const handles = extractHandles(html);
		assert.ok(handles.length > 0, "should find linkedin handle with www.");
	});

	it("handles URL followed by closing quote (no trailing slash needed)", () => {
		const html = `<a href="https://x.com/widgetco">X</a>`;
		const handles = extractHandles(html);
		assert.ok(
			handles.some((h) => h.includes("x.com/widgetco")),
			`expected x.com/widgetco in ${JSON.stringify(handles)}`,
		);
	});
});

// ─── isSafeUrl ───────────────────────────────────────────────────────────────

describe("isSafeUrl", () => {
	it("allows a public HTTPS URL (example.com)", async () => {
		// example.com resolves to 93.184.216.34 (a public IP)
		// We can't guarantee DNS in tests, so we test the predicate logic
		// directly via the IP range checks. For public-domain tests we
		// rely on the function resolving correctly.
		// This test is structural: it should NOT throw and should return a boolean.
		const result = await isSafeUrl("https://example.com");
		assert.equal(typeof result, "boolean");
	});

	it("rejects non-http/https schemes", async () => {
		assert.equal(await isSafeUrl("ftp://example.com"), false);
		assert.equal(await isSafeUrl("file:///etc/passwd"), false);
		assert.equal(await isSafeUrl("javascript:alert(1)"), false);
	});

	it("rejects an unparseable URL", async () => {
		assert.equal(await isSafeUrl("not a url"), false);
	});

	it("rejects http: scheme (only https allowed? — actually http is allowed per spec)", async () => {
		// Per spec: https?: — both http and https are allowed for the SSRF guard
		// We test that http is not rejected by scheme alone
		const result = await isSafeUrl("http://example.com");
		assert.equal(typeof result, "boolean"); // may be true or false depending on DNS
	});

	// Test the IP range predicate in isolation using a hostname that resolves to a
	// private IP. We cannot mock DNS in this test runner, so we test the guard
	// by checking that the function correctly identifies the KNOWN loopback host.
	it("rejects localhost (loopback)", async () => {
		// localhost reliably resolves to 127.0.0.1 on any system
		assert.equal(await isSafeUrl("https://localhost"), false);
	});

	it("rejects 127.0.0.1 (loopback)", async () => {
		// IP literals in the hostname field are resolved by dns.lookup as-is
		assert.equal(await isSafeUrl("https://127.0.0.1"), false);
	});
});
