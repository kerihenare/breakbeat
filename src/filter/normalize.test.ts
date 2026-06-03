import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
	matchesHandlePrefix,
	normalizeHandle,
	normalizeHost,
	normalizeTitle,
	normalizeUrl,
} from "./normalize.ts";

describe("normalizeHost", () => {
	it("extracts and lowercases the host from a full URL", () => {
		assert.equal(normalizeHost("https://www.Acme.com/x"), "acme.com");
	});

	it("strips www. prefix", () => {
		assert.equal(normalizeHost("https://www.example.com/path"), "example.com");
	});

	it("lowercases the host", () => {
		assert.equal(normalizeHost("https://EXAMPLE.COM/"), "example.com");
	});

	it("does not strip non-www subdomains", () => {
		assert.equal(
			normalizeHost("https://blog.example.com/"),
			"blog.example.com",
		);
	});

	it("handles URLs without paths", () => {
		assert.equal(normalizeHost("https://acme.com"), "acme.com");
	});

	it("handles http scheme", () => {
		assert.equal(normalizeHost("http://www.example.com/"), "example.com");
	});

	it("falls back to lowercase trimmed input for bare domain (no scheme)", () => {
		assert.equal(normalizeHost("acme.com"), "acme.com");
	});

	it("falls back to lowercase trimmed input for invalid URL", () => {
		assert.equal(normalizeHost("  ACME Corp  "), "acme corp");
	});

	it("handles empty string gracefully", () => {
		assert.equal(normalizeHost(""), "");
	});

	it("handles URL with port (strips www. but keeps host:port would be unusual — just host)", () => {
		// port is part of host in URL API; normalizeHost returns hostname only (no port)
		assert.equal(normalizeHost("https://www.example.com:8080/"), "example.com");
	});

	it("handles mixed case www. prefix", () => {
		// The www-strip should apply after lowercase
		assert.equal(normalizeHost("https://WWW.Example.COM/"), "example.com");
	});
});

describe("normalizeUrl", () => {
	// Pinned test cases from spec — these MUST pass as-is
	it("pinned: drops scheme, strips www, strips tracking params, sorts params, strips fragment, strips trailing slash", () => {
		assert.equal(
			normalizeUrl("https://www.Example.com/Path/?utm_source=x&b=2&a=1#frag"),
			"example.com/Path?a=1&b=2",
		);
	});

	it("pinned: http scheme → same key as https", () => {
		assert.equal(
			normalizeUrl("http://example.com/news/item"),
			"example.com/news/item",
		);
	});

	it("pinned: trailing slash on path stripped", () => {
		assert.equal(
			normalizeUrl("https://example.com/news/item/"),
			"example.com/news/item",
		);
	});

	it("pinned: http and https trailing-slash variants collapse to same key", () => {
		const a = normalizeUrl("http://example.com/news/item");
		const b = normalizeUrl("https://example.com/news/item/");
		assert.equal(a, b);
	});

	it("pinned: strips fbclid, keeps v= param", () => {
		assert.equal(
			normalizeUrl("https://youtube.com/watch?v=abc&fbclid=xyz"),
			"youtube.com/watch?v=abc",
		);
	});

	it("pinned: strips ref and source tracking params", () => {
		assert.equal(
			normalizeUrl("https://news.example.com/post?ref=hn&source=tw"),
			"news.example.com/post",
		);
	});

	it("strips utm_* params (any utm_ prefix)", () => {
		assert.equal(
			normalizeUrl(
				"https://example.com/article?utm_campaign=foo&utm_medium=bar&id=42",
			),
			"example.com/article?id=42",
		);
	});

	it("strips gclid tracking param", () => {
		assert.equal(
			normalizeUrl("https://example.com/page?gclid=abc123&q=hello"),
			"example.com/page?q=hello",
		);
	});

	it("strips mc_cid tracking param", () => {
		assert.equal(
			normalizeUrl("https://example.com/page?mc_cid=abc&q=hello"),
			"example.com/page?q=hello",
		);
	});

	it("preserves path case", () => {
		assert.equal(
			normalizeUrl("https://example.com/MyPath/SomeArticle"),
			"example.com/MyPath/SomeArticle",
		);
	});

	it("sorts remaining query params", () => {
		assert.equal(
			normalizeUrl("https://example.com/page?z=last&a=first&m=mid"),
			"example.com/page?a=first&m=mid&z=last",
		);
	});

	it("handles URL with no query params or fragment", () => {
		assert.equal(
			normalizeUrl("https://example.com/article"),
			"example.com/article",
		);
	});

	it("handles root path (single slash)", () => {
		assert.equal(normalizeUrl("https://example.com/"), "example.com");
	});

	it("strips non-www subdomain is preserved", () => {
		assert.equal(
			normalizeUrl("https://blog.example.com/post"),
			"blog.example.com/post",
		);
	});
});

describe("normalizeTitle", () => {
	// Pinned adversarial test: TechCrunch/Yahoo syndication pair collapses
	it("pinned: TechCrunch and Yahoo Finance syndication copies produce the same key", () => {
		const tc = normalizeTitle("Acme raises $10M | TechCrunch");
		const yf = normalizeTitle("Acme raises $10M - Yahoo Finance");
		assert.equal(tc, yf, `TechCrunch key: "${tc}", Yahoo Finance key: "${yf}"`);
	});

	// Pinned adversarial test: short remainder prevents strip
	it("pinned: Acme - The Real Story survives intact (remainder too short after stripping)", () => {
		// Full title "Acme - The Real Story" is 21 chars < 25, so stripping is refused
		const result = normalizeTitle("Acme - The Real Story");
		// "-" gets stripped as punctuation; whitespace collapses to single space
		assert.equal(result, "acme the real story");
	});

	it("pinned: long segment > 40 chars is not stripped", () => {
		// Segment "This Is A Very Long Subtitle That Is Way Too Long For An Outlet Name" is > 40 chars
		const title =
			"Acme announces new product line - This Is A Very Long Subtitle That Is Way Too Long For An Outlet Name";
		// No stripping because segment > 40 chars; "-" stripped as punctuation; whitespace collapses
		const result = normalizeTitle(title);
		assert.equal(
			result,
			"acme announces new product line this is a very long subtitle that is way too long for an outlet name",
		);
	});

	it("strips outlet suffix with pipe separator", () => {
		const result = normalizeTitle(
			"A long enough title to allow stripping | TechCrunch",
		);
		assert.equal(result, "a long enough title to allow stripping");
	});

	it("strips outlet suffix with dash separator", () => {
		const result = normalizeTitle(
			"A long enough title to allow stripping - The Verge",
		);
		assert.equal(result, "a long enough title to allow stripping");
	});

	it("strips outlet suffix with en-dash separator", () => {
		const result = normalizeTitle(
			"A long enough title to allow stripping – Reuters",
		);
		assert.equal(result, "a long enough title to allow stripping");
	});

	it("NFKC normalization", () => {
		// NFKC: fi ligature → fi, fullwidth chars → ASCII, etc.
		const result = normalizeTitle("ﬁnancial results");
		assert.equal(result, "financial results");
	});

	it("lowercases the title", () => {
		assert.equal(normalizeTitle("HELLO WORLD"), "hello world");
	});

	it("strips punctuation (non-alphanumeric non-whitespace)", () => {
		assert.equal(normalizeTitle("Hello, World! (2024)"), "hello world 2024");
	});

	it("collapses whitespace", () => {
		assert.equal(normalizeTitle("  hello   world  "), "hello world");
	});

	it("caret is treated as punctuation", () => {
		const result = normalizeTitle("Acme^news article headline test here check");
		assert.equal(result, "acmenews article headline test here check");
	});

	it("en-dash in title without outlet stripping context is stripped as punctuation", () => {
		// An en-dash mid-title with no space separating an outlet suffix
		const result = normalizeTitle("Hello–world this is a test");
		assert.equal(result, "helloworld this is a test");
	});

	it("only strips the LAST separator segment", () => {
		// Multiple separators: only last is stripped (if it qualifies)
		const result = normalizeTitle(
			"A fairly long title that is here - Section - Outlet",
		);
		// Full title is 51 chars ≥ 25; "Outlet" segment is 6 chars ≤ 40 → strip fires
		// Remainder: "A fairly long title that is here - Section"
		// Then: lowercase → punctuation strip (removes "-") → whitespace collapse
		assert.equal(result, "a fairly long title that is here section");
	});

	it("does not strip if full title is < 25 chars", () => {
		// "Short - Outlet Name" = 19 chars < 25 → no stripping
		const result = normalizeTitle("Short - Outlet Name");
		// "-" stripped as punctuation; whitespace collapses
		assert.equal(result, "short outlet name");
	});
});

describe("normalizeHandle", () => {
	it("normalizes a twitter.com URL to x.com", () => {
		assert.equal(normalizeHandle("https://twitter.com/acme"), "x.com/acme");
	});

	it("normalizes www.twitter.com to x.com", () => {
		assert.equal(normalizeHandle("https://www.twitter.com/acme"), "x.com/acme");
	});

	it("lowercases the entire URL including path", () => {
		assert.equal(normalizeHandle("https://x.com/AcmeCorp"), "x.com/acmecorp");
	});

	it("strips tracking params and fragment", () => {
		assert.equal(
			normalizeHandle("https://x.com/Acme?utm_source=x#section"),
			"x.com/acme",
		);
	});

	it("normalizes linkedin handle", () => {
		assert.equal(
			normalizeHandle("https://www.linkedin.com/company/Acme"),
			"linkedin.com/company/acme",
		);
	});

	it("strips trailing slash on path", () => {
		assert.equal(normalizeHandle("https://x.com/acme/"), "x.com/acme");
	});
});

describe("matchesHandlePrefix", () => {
	// Pinned test cases from spec
	it("pinned: x.com/Acme matches https://x.com/acme/status/123 (case-folded, path-prefix)", () => {
		assert.equal(
			matchesHandlePrefix("x.com/Acme", "https://x.com/acme/status/123"),
			true,
		);
	});

	it("pinned: twitter.com/acme matches x.com/acme/status/456 (alias canonicalized)", () => {
		assert.equal(
			matchesHandlePrefix("twitter.com/acme", "https://x.com/acme/status/456"),
			true,
		);
	});

	it("pinned: x.com/acme does NOT match x.com/acmecorp/post (segment boundary)", () => {
		assert.equal(
			matchesHandlePrefix("x.com/acme", "https://x.com/acmecorp/post"),
			false,
		);
	});

	it("matches when prefix equals the full normalized URL (end of string boundary)", () => {
		assert.equal(matchesHandlePrefix("x.com/acme", "https://x.com/acme"), true);
	});

	it("matches when next char after prefix is ?", () => {
		assert.equal(
			matchesHandlePrefix("x.com/acme", "https://x.com/acme?foo=bar"),
			true,
		);
	});

	it("does not match completely different domain", () => {
		assert.equal(
			matchesHandlePrefix("x.com/acme", "https://linkedin.com/company/acme"),
			false,
		);
	});

	it("does not match when prefix is longer than the url", () => {
		assert.equal(
			matchesHandlePrefix("x.com/acme/longer/path", "https://x.com/acme"),
			false,
		);
	});
});
