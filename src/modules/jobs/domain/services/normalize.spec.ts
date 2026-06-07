import {
	matchesHandlePrefix,
	normalizeHandle,
	normalizeHost,
	normalizeTitle,
	normalizeUrl,
} from "./normalize";

describe("normalizeHost", () => {
	it("extracts and lowercases the host from a full URL", () => {
		expect(normalizeHost("https://www.Acme.com/x")).toBe("acme.com");
	});

	it("strips www. prefix", () => {
		expect(normalizeHost("https://www.example.com/path")).toBe("example.com");
	});

	it("lowercases the host", () => {
		expect(normalizeHost("https://EXAMPLE.COM/")).toBe("example.com");
	});

	it("does not strip non-www subdomains", () => {
		expect(normalizeHost("https://blog.example.com/")).toBe("blog.example.com");
	});

	it("handles URLs without paths", () => {
		expect(normalizeHost("https://acme.com")).toBe("acme.com");
	});

	it("handles http scheme", () => {
		expect(normalizeHost("http://www.example.com/")).toBe("example.com");
	});

	it("falls back to lowercase trimmed input for bare domain (no scheme)", () => {
		expect(normalizeHost("acme.com")).toBe("acme.com");
	});

	it("falls back to lowercase trimmed input for invalid URL", () => {
		expect(normalizeHost("  ACME Corp  ")).toBe("acme corp");
	});

	it("handles empty string gracefully", () => {
		expect(normalizeHost("")).toBe("");
	});

	it("handles URL with port (strips www. but keeps host:port would be unusual — just host)", () => {
		// port is part of host in URL API; normalizeHost returns hostname only (no port)
		expect(normalizeHost("https://www.example.com:8080/")).toBe("example.com");
	});

	it("handles mixed case www. prefix", () => {
		// The www-strip should apply after lowercase
		expect(normalizeHost("https://WWW.Example.COM/")).toBe("example.com");
	});
});

describe("normalizeUrl", () => {
	// Pinned test cases from spec — these MUST pass as-is
	it("pinned: drops scheme, strips www, strips tracking params, sorts params, strips fragment, strips trailing slash", () => {
		expect(
			normalizeUrl("https://www.Example.com/Path/?utm_source=x&b=2&a=1#frag"),
		).toBe("example.com/Path?a=1&b=2");
	});

	it("pinned: http scheme → same key as https", () => {
		expect(normalizeUrl("http://example.com/news/item")).toBe(
			"example.com/news/item",
		);
	});

	it("pinned: trailing slash on path stripped", () => {
		expect(normalizeUrl("https://example.com/news/item/")).toBe(
			"example.com/news/item",
		);
	});

	it("pinned: http and https trailing-slash variants collapse to same key", () => {
		const a = normalizeUrl("http://example.com/news/item");
		const b = normalizeUrl("https://example.com/news/item/");
		expect(a).toBe(b);
	});

	it("pinned: strips fbclid, keeps v= param", () => {
		expect(normalizeUrl("https://youtube.com/watch?v=abc&fbclid=xyz")).toBe(
			"youtube.com/watch?v=abc",
		);
	});

	it("pinned: strips ref and source tracking params", () => {
		expect(normalizeUrl("https://news.example.com/post?ref=hn&source=tw")).toBe(
			"news.example.com/post",
		);
	});

	it("strips utm_* params (any utm_ prefix)", () => {
		expect(
			normalizeUrl(
				"https://example.com/article?utm_campaign=foo&utm_medium=bar&id=42",
			),
		).toBe("example.com/article?id=42");
	});

	it("strips gclid tracking param", () => {
		expect(normalizeUrl("https://example.com/page?gclid=abc123&q=hello")).toBe(
			"example.com/page?q=hello",
		);
	});

	it("strips mc_cid tracking param", () => {
		expect(normalizeUrl("https://example.com/page?mc_cid=abc&q=hello")).toBe(
			"example.com/page?q=hello",
		);
	});

	it("preserves path case", () => {
		expect(normalizeUrl("https://example.com/MyPath/SomeArticle")).toBe(
			"example.com/MyPath/SomeArticle",
		);
	});

	it("sorts remaining query params", () => {
		expect(normalizeUrl("https://example.com/page?z=last&a=first&m=mid")).toBe(
			"example.com/page?a=first&m=mid&z=last",
		);
	});

	it("handles URL with no query params or fragment", () => {
		expect(normalizeUrl("https://example.com/article")).toBe(
			"example.com/article",
		);
	});

	it("handles root path (single slash)", () => {
		expect(normalizeUrl("https://example.com/")).toBe("example.com");
	});

	it("strips non-www subdomain is preserved", () => {
		expect(normalizeUrl("https://blog.example.com/post")).toBe(
			"blog.example.com/post",
		);
	});
});

describe("normalizeTitle", () => {
	// Pinned adversarial test: TechCrunch/Yahoo syndication pair collapses
	it("pinned: TechCrunch and Yahoo Finance syndication copies produce the same key", () => {
		const tc = normalizeTitle("Acme raises $10M | TechCrunch");
		const yf = normalizeTitle("Acme raises $10M - Yahoo Finance");
		expect(tc).toBe(yf);
	});

	// Pinned adversarial test: short remainder prevents strip
	it("pinned: Acme - The Real Story survives intact (remainder too short after stripping)", () => {
		// Full title "Acme - The Real Story" is 21 chars < 25, so stripping is refused
		const result = normalizeTitle("Acme - The Real Story");
		// "-" gets stripped as punctuation; whitespace collapses to single space
		expect(result).toBe("acme the real story");
	});

	it("pinned: long segment > 40 chars is not stripped", () => {
		// Segment "This Is A Very Long Subtitle That Is Way Too Long For An Outlet Name" is > 40 chars
		const title =
			"Acme announces new product line - This Is A Very Long Subtitle That Is Way Too Long For An Outlet Name";
		// No stripping because segment > 40 chars; "-" stripped as punctuation; whitespace collapses
		const result = normalizeTitle(title);
		expect(result).toBe(
			"acme announces new product line this is a very long subtitle that is way too long for an outlet name",
		);
	});

	it("strips outlet suffix with pipe separator", () => {
		const result = normalizeTitle(
			"A long enough title to allow stripping | TechCrunch",
		);
		expect(result).toBe("a long enough title to allow stripping");
	});

	it("strips outlet suffix with dash separator", () => {
		const result = normalizeTitle(
			"A long enough title to allow stripping - The Verge",
		);
		expect(result).toBe("a long enough title to allow stripping");
	});

	it("strips outlet suffix with en-dash separator", () => {
		const result = normalizeTitle(
			"A long enough title to allow stripping – Reuters",
		);
		expect(result).toBe("a long enough title to allow stripping");
	});

	it("NFKC normalization", () => {
		// NFKC: fi ligature → fi, fullwidth chars → ASCII, etc.
		const result = normalizeTitle("ﬁnancial results");
		expect(result).toBe("financial results");
	});

	it("lowercases the title", () => {
		expect(normalizeTitle("HELLO WORLD")).toBe("hello world");
	});

	it("strips punctuation (non-alphanumeric non-whitespace)", () => {
		expect(normalizeTitle("Hello, World! (2024)")).toBe("hello world 2024");
	});

	it("collapses whitespace", () => {
		expect(normalizeTitle("  hello   world  ")).toBe("hello world");
	});

	it("caret is treated as punctuation", () => {
		const result = normalizeTitle("Acme^news article headline test here check");
		expect(result).toBe("acmenews article headline test here check");
	});

	it("en-dash in title without outlet stripping context is stripped as punctuation", () => {
		// An en-dash mid-title with no space separating an outlet suffix
		const result = normalizeTitle("Hello–world this is a test");
		expect(result).toBe("helloworld this is a test");
	});

	it("only strips the LAST separator segment", () => {
		// Multiple separators: only last is stripped (if it qualifies)
		const result = normalizeTitle(
			"A fairly long title that is here - Section - Outlet",
		);
		// Full title is 51 chars ≥ 25; "Outlet" segment is 6 chars ≤ 40 → strip fires
		// Remainder: "A fairly long title that is here - Section"
		// Then: lowercase → punctuation strip (removes "-") → whitespace collapse
		expect(result).toBe("a fairly long title that is here section");
	});

	it("does not strip if full title is < 25 chars", () => {
		// "Short - Outlet Name" = 19 chars < 25 → no stripping
		const result = normalizeTitle("Short - Outlet Name");
		// "-" stripped as punctuation; whitespace collapses
		expect(result).toBe("short outlet name");
	});
});

describe("normalizeHandle", () => {
	it("normalizes a twitter.com URL to x.com", () => {
		expect(normalizeHandle("https://twitter.com/acme")).toBe("x.com/acme");
	});

	it("normalizes www.twitter.com to x.com", () => {
		expect(normalizeHandle("https://www.twitter.com/acme")).toBe("x.com/acme");
	});

	it("lowercases the entire URL including path", () => {
		expect(normalizeHandle("https://x.com/AcmeCorp")).toBe("x.com/acmecorp");
	});

	it("strips tracking params and fragment", () => {
		expect(normalizeHandle("https://x.com/Acme?utm_source=x#section")).toBe(
			"x.com/acme",
		);
	});

	it("normalizes linkedin handle", () => {
		expect(normalizeHandle("https://www.linkedin.com/company/Acme")).toBe(
			"linkedin.com/company/acme",
		);
	});

	it("strips trailing slash on path", () => {
		expect(normalizeHandle("https://x.com/acme/")).toBe("x.com/acme");
	});

	it("falls back to trimmed lowercase for unparseable input", () => {
		expect(normalizeHandle("  Not A Url  ")).toBe("not a url");
	});
});

describe("matchesHandlePrefix", () => {
	// Pinned test cases from spec
	it("pinned: x.com/Acme matches https://x.com/acme/status/123 (case-folded, path-prefix)", () => {
		expect(
			matchesHandlePrefix("x.com/Acme", "https://x.com/acme/status/123"),
		).toBe(true);
	});

	it("pinned: twitter.com/acme matches x.com/acme/status/456 (alias canonicalized)", () => {
		expect(
			matchesHandlePrefix("twitter.com/acme", "https://x.com/acme/status/456"),
		).toBe(true);
	});

	it("pinned: x.com/acme does NOT match x.com/acmecorp/post (segment boundary)", () => {
		expect(
			matchesHandlePrefix("x.com/acme", "https://x.com/acmecorp/post"),
		).toBe(false);
	});

	it("matches when prefix equals the full normalized URL (end of string boundary)", () => {
		expect(matchesHandlePrefix("x.com/acme", "https://x.com/acme")).toBe(true);
	});

	it("matches when next char after prefix is ?", () => {
		expect(
			matchesHandlePrefix("x.com/acme", "https://x.com/acme?foo=bar"),
		).toBe(true);
	});

	it("does not match completely different domain", () => {
		expect(
			matchesHandlePrefix("x.com/acme", "https://linkedin.com/company/acme"),
		).toBe(false);
	});

	it("does not match when prefix is longer than the url", () => {
		expect(
			matchesHandlePrefix("x.com/acme/longer/path", "https://x.com/acme"),
		).toBe(false);
	});
});
