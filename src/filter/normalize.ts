/**
 * Normalize a raw URL or hostname string to a bare lowercased hostname.
 *
 * Rules:
 * - Parse as a URL; on success, use the `hostname` (never `host`, so ports are dropped)
 * - Lowercase the result
 * - Strip a leading `www.` prefix
 * - On parse failure (no scheme, plain name, etc.) return `raw.trim().toLowerCase()`
 *
 * Examples:
 *   normalizeHost("https://www.Acme.com/x") → "acme.com"
 *   normalizeHost("acme.com")               → "acme.com"  (fallback)
 *   normalizeHost("  ACME Corp  ")          → "acme corp" (fallback)
 */
export function normalizeHost(raw: string): string {
	try {
		const parsed = new URL(raw);
		// Use hostname (strips port) then lowercase
		let host = parsed.hostname.toLowerCase();
		if (host.startsWith("www.")) {
			host = host.slice(4);
		}
		return host;
	} catch {
		// Not a parseable URL — return trimmed lowercase as-is
		return raw.trim().toLowerCase();
	}
}

/**
 * Known tracking query parameter names/prefixes to strip during URL normalization.
 * Blocklist-of-trackers, not allowlist-of-params — keeps genuine content params intact.
 */
const TRACKING_PARAMS = new Set(["fbclid", "gclid", "mc_cid", "ref", "source"]);

function isTrackingParam(name: string): boolean {
	if (name.startsWith("utm_")) return true;
	return TRACKING_PARAMS.has(name);
}

/**
 * Produce the unique dedup key for a URL.
 *
 * Rules (pinned — these are the dedup policy):
 * 1. Lowercase host, strip `www.`
 * 2. Drop the scheme — http and https map to the same key
 * 3. Strip the fragment
 * 4. Strip ONLY known tracking params: `utm_*`, `fbclid`, `gclid`, `mc_cid`, `ref`, `source`
 *    Keep everything else (e.g. `v=`, `id=` — genuinely distinct content)
 * 5. Sort remaining query params (order never defeats dedup)
 * 6. Strip trailing slash on path; preserve path case
 *
 * Pinned examples:
 *   "https://www.Example.com/Path/?utm_source=x&b=2&a=1#frag" → "example.com/Path?a=1&b=2"
 *   "http://example.com/news/item"                            → "example.com/news/item"
 *   "https://example.com/news/item/"                          → "example.com/news/item"
 *   "https://youtube.com/watch?v=abc&fbclid=xyz"              → "youtube.com/watch?v=abc"
 *   "https://news.example.com/post?ref=hn&source=tw"          → "news.example.com/post"
 */
export function normalizeUrl(raw: string): string {
	const parsed = new URL(raw);

	// 1. Lowercase host, strip www.
	let host = parsed.hostname.toLowerCase();
	if (host.startsWith("www.")) {
		host = host.slice(4);
	}

	// 6. Strip trailing slash on path; preserve path case
	let path = parsed.pathname;
	if (path.endsWith("/") && path.length > 1) {
		path = path.slice(0, -1);
	}
	// Root path "/" → empty string (no trailing slash needed)
	if (path === "/") {
		path = "";
	}

	// 4 & 5. Strip tracking params, sort remaining
	const remaining: Array<[string, string]> = [];
	for (const [name, value] of parsed.searchParams.entries()) {
		if (!isTrackingParam(name)) {
			remaining.push([name, value]);
		}
	}
	remaining.sort(([a], [b]) => a.localeCompare(b));

	// Build key: host + path (no scheme, no fragment)
	let key = host + path;
	if (remaining.length > 0) {
		const qs = remaining
			.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
			.join("&");
		key += `?${qs}`;
	}

	return key;
}

/**
 * Produce the Collapse key for title deduplication.
 *
 * Rules (pinned):
 * 1. Unicode NFKC normalization
 * 2. Outlet-suffix stripping: strip trailing ` | X` / ` – X` / ` - X` segment, ONLY if:
 *    - Final separator only (strip only the LAST such segment)
 *    - The remaining title (after stripping) is still ≥ 25 chars
 *    - The stripped segment is ≤ 40 chars
 * 3. Lowercase
 * 4. Strip punctuation (non-alphanumeric, non-whitespace characters)
 * 5. Collapse whitespace
 */
export function normalizeTitle(raw: string): string {
	// 1. NFKC normalization
	let title = raw.normalize("NFKC");

	// 2. Outlet-suffix stripping (before lowercasing so we can measure char length accurately)
	// Match the last separator (|, –, -) followed by a segment
	// Separator must be preceded and followed by a space; use greedy match to get the LAST separator
	const suffixPattern = /^(.*\S)\s+[|\-–]\s+(\S.*)$/;
	const match = title.match(suffixPattern);
	if (match) {
		const segment = match[2];
		// Guard: full title must be ≥ 25 chars AND segment ≤ 40 chars
		// (Using full title length as the guard so short syndicated titles like
		// "Acme raises $10M | TechCrunch" still collapse — the spec's pinned example.)
		if (title.length >= 25 && segment.length <= 40) {
			title = match[1];
		}
	}

	// 3. Lowercase
	title = title.toLowerCase();

	// 4. Strip punctuation (non-alphanumeric, non-whitespace)
	title = title.replace(/[^\p{L}\p{N}\s]/gu, "");

	// 5. Collapse whitespace (trim + internal collapse)
	title = title.replace(/\s+/g, " ").trim();

	return title;
}

/**
 * Produce the own-channel handle key.
 *
 * Applies normalizeUrl logic but lowercases EVERYTHING including path.
 * Canonicalizes twitter.com → x.com.
 */
export function normalizeHandle(raw: string): string {
	// Ensure raw has a scheme for URL parsing; if not, try prepending https://
	let toParse = raw;
	if (!toParse.startsWith("http://") && !toParse.startsWith("https://")) {
		toParse = `https://${toParse}`;
	}

	let parsed: URL;
	try {
		parsed = new URL(toParse);
	} catch {
		// Not a parseable URL — return trimmed lowercase as-is
		return raw.trim().toLowerCase();
	}

	// Lowercase host, strip www.
	let host = parsed.hostname.toLowerCase();
	if (host.startsWith("www.")) {
		host = host.slice(4);
	}

	// Canonicalize twitter.com → x.com
	if (host === "twitter.com") {
		host = "x.com";
	}

	// Strip trailing slash on path; lowercase entire path (handles are case-insensitive)
	let path = parsed.pathname.toLowerCase();
	if (path.endsWith("/") && path.length > 1) {
		path = path.slice(0, -1);
	}
	if (path === "/") {
		path = "";
	}

	// Strip tracking params, sort remaining (same logic as normalizeUrl)
	const remaining: Array<[string, string]> = [];
	for (const [name, value] of parsed.searchParams.entries()) {
		if (!isTrackingParam(name)) {
			remaining.push([name.toLowerCase(), value.toLowerCase()]);
		}
	}
	remaining.sort(([a], [b]) => a.localeCompare(b));

	let key = host + path;
	if (remaining.length > 0) {
		const qs = remaining
			.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
			.join("&");
		key += `?${qs}`;
	}

	return key;
}

/**
 * Returns true if prefix (as a handle) is a path-segment–boundary prefix of url (as a handle).
 *
 * Segment-boundary aware: the character immediately after the prefix in the normalized url
 * must be `/`, `?`, or end-of-string — never a partial segment match.
 *
 * Examples:
 *   matchesHandlePrefix("x.com/Acme", "https://x.com/acme/status/123") → true
 *   matchesHandlePrefix("twitter.com/acme", "https://x.com/acme/status/456") → true
 *   matchesHandlePrefix("x.com/acme", "https://x.com/acmecorp/post") → false
 */
export function matchesHandlePrefix(prefix: string, url: string): boolean {
	const normalizedPrefix = normalizeHandle(prefix);
	const normalizedUrl = normalizeHandle(url);

	if (!normalizedUrl.startsWith(normalizedPrefix)) {
		return false;
	}

	// Check segment boundary: next char must be '/', '?', or end-of-string
	const nextChar = normalizedUrl[normalizedPrefix.length];
	return nextChar === undefined || nextChar === "/" || nextChar === "?";
}
