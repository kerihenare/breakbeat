import dns from "node:dns/promises";
import type { DatabaseSync } from "node:sqlite";
import Anthropic from "@anthropic-ai/sdk";
import { tavily } from "@tavily/core";
import { addWarning, transition } from "./queue.ts";

// ─── Never-a-homepage blocklist ───────────────────────────────────────────────

/**
 * Domains that will never be a company's own homepage.
 * Used by pickHomepage() to guard the heuristic cascade.
 */
export const NEVER_HOMEPAGE: ReadonlySet<string> = new Set([
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
]);

// ─── Tavily query constants ────────────────────────────────────────────────────

const TAVILY_SEARCH_DEPTH = "basic" as const;
const TAVILY_MAX_RESULTS = 5;
const TAVILY_TOPIC = "general" as const;

// ─── computeWindow ────────────────────────────────────────────────────────────

/**
 * Compute the 36-month search window anchored on the job's creation date.
 *
 * Both dates are date-only UTC strings (YYYY-MM-DD).
 * Spec example: created 2026-06-03 → window 2023-06-03 → 2026-06-03.
 *
 * Uses calendar-month arithmetic: subtract 36 from the month field and
 * carry years accordingly, then clamp to valid month-end where needed
 * (e.g. 2026-03-31 − 36 months → 2023-03-31, not Feb 28).
 */
export function computeWindow(createdAt: string): {
	windowStart: string;
	windowEnd: string;
} {
	// Parse the date-only string as UTC
	const [yearStr, monthStr, dayStr] = createdAt.split("-");
	const year = parseInt(yearStr, 10);
	const month = parseInt(monthStr, 10); // 1-based
	const day = parseInt(dayStr, 10);

	// Subtract 36 calendar months
	let startYear = year;
	let startMonth = month - 36;
	while (startMonth <= 0) {
		startMonth += 12;
		startYear -= 1;
	}

	// Clamp day to valid month-end (e.g. March 31 − 36 months → March 31 is fine,
	// but Feb 31 → Feb 28/29 if month had fewer days)
	const daysInStartMonth = new Date(
		Date.UTC(startYear, startMonth, 0),
	).getUTCDate();
	const clampedDay = Math.min(day, daysInStartMonth);

	const windowStart = `${String(startYear).padStart(4, "0")}-${String(startMonth).padStart(2, "0")}-${String(clampedDay).padStart(2, "0")}`;
	const windowEnd = createdAt;

	return { windowEnd, windowStart };
}

// ─── CandidatePage ────────────────────────────────────────────────────────────

export type CandidatePage = {
	url: string;
	title: string;
};

// ─── pickHomepage ─────────────────────────────────────────────────────────────

/**
 * Heuristic homepage picker over a fixed candidate list.
 *
 * First candidate passing both guards wins:
 * 1. Domain is NOT on NEVER_HOMEPAGE blocklist.
 * 2. A name token (individual word from companyName) appears in the domain or title
 *    (case-insensitive substring match).
 *
 * Returns the URL of the first matching candidate, or null if none match.
 */
export function pickHomepage(
	candidates: CandidatePage[],
	companyName: string,
): string | null {
	// Tokenize name: split on whitespace and punctuation, lowercase, filter empty
	const nameTokens = companyName
		.toLowerCase()
		.split(/[\s\W]+/)
		.filter((t) => t.length > 0);

	for (const candidate of candidates) {
		// Guard 1: domain not on blocklist
		let hostname: string;
		try {
			hostname = new URL(candidate.url).hostname.toLowerCase();
			if (hostname.startsWith("www.")) {
				hostname = hostname.slice(4);
			}
		} catch {
			// unparseable URL — skip
			continue;
		}

		// Check if hostname contains any segment from NEVER_HOMEPAGE
		const isBlocked = [...NEVER_HOMEPAGE].some(
			(blocked) => hostname === blocked || hostname.endsWith(`.${blocked}`),
		);
		if (isBlocked) continue;

		// Guard 2: at least one name token appears in the domain or title
		const titleLower = candidate.title.toLowerCase();
		const hasMatch = nameTokens.some(
			(token) => hostname.includes(token) || titleLower.includes(token),
		);
		if (!hasMatch) continue;

		return candidate.url;
	}

	return null;
}

// ─── extractHandles ──────────────────────────────────────────────────────────

/**
 * Extract LinkedIn company URLs and X/Twitter handles from raw HTML.
 *
 * Looks for:
 * - linkedin.com/company/<slug>
 * - twitter.com/<handle> or x.com/<handle>
 *
 * Returns the found URLs as strings (original form found in the HTML).
 */
export function extractHandles(html: string): string[] {
	const handles: string[] = [];
	const seen = new Set<string>();

	// LinkedIn company URLs
	const linkedinRe =
		/https?:\/\/(?:www\.)?linkedin\.com\/company\/([A-Za-z0-9_%-]+)/g;
	for (const match of html.matchAll(linkedinRe)) {
		const url = match[0];
		if (!seen.has(url)) {
			seen.add(url);
			handles.push(url);
		}
	}

	// X/Twitter handles — lookahead so the boundary char is not consumed
	const twitterRe =
		/https?:\/\/(?:www\.)?(?:twitter|x)\.com\/([A-Za-z0-9_]+)(?=[/?#"'\s>]|$)/g;
	for (const match of html.matchAll(twitterRe)) {
		// Skip known non-handle paths (intent, search, hashtag, share, home, etc.)
		const slug = match[1];
		if (
			["intent", "search", "hashtag", "share", "home", "i"].includes(
				slug.toLowerCase(),
			)
		) {
			continue;
		}
		const url = match[0];
		if (!seen.has(url)) {
			seen.add(url);
			handles.push(url);
		}
	}

	return handles;
}

// ─── isSafeUrl ───────────────────────────────────────────────────────────────

/**
 * SSRF guard: resolve the hostname and reject private/loopback/link-local ranges.
 *
 * Rejects:
 * - Non-http/https schemes
 * - 127.x.x.x, ::1 (loopback)
 * - 10.x.x.x, 172.16-31.x.x, 192.168.x.x (private)
 * - 169.254.x.x (IPv4 link-local)
 * - fe80::/10 (IPv6 link-local)
 *
 * Resolves to true if safe, false if unsafe or unparseable.
 */
export async function isSafeUrl(url: string): Promise<boolean> {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return false;
	}

	// Only allow http and https
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		return false;
	}

	let addresses: { address: string; family: number }[];
	try {
		addresses = await dns.lookup(parsed.hostname, { all: true });
	} catch {
		// DNS failure — treat as unsafe (can't verify)
		return false;
	}

	for (const { address } of addresses) {
		if (isPrivateOrReservedIp(address)) {
			return false;
		}
	}

	return true;
}

/**
 * Returns true if the IP address falls in a private/loopback/link-local range.
 */
function isPrivateOrReservedIp(address: string): boolean {
	// IPv4 checks
	if (address.includes(".")) {
		const parts = address.split(".").map(Number);
		if (parts.length !== 4) return false;
		const [a, b, _c] = parts;

		// Loopback: 127.x.x.x
		if (a === 127) return true;
		// Private: 10.x.x.x
		if (a === 10) return true;
		// Private: 172.16-31.x.x
		if (a === 172 && b >= 16 && b <= 31) return true;
		// Private: 192.168.x.x
		if (a === 192 && b === 168) return true;
		// Link-local: 169.254.x.x
		if (a === 169 && b === 254) return true;

		return false;
	}

	// IPv6 checks
	const addr = address.toLowerCase();

	// Loopback: ::1
	if (addr === "::1") return true;

	// Link-local: fe80::/10 — starts with fe8, fe9, fea, feb
	if (/^fe[89ab]/i.test(addr)) return true;

	// Mapped IPv4 private addresses (::ffff:192.168.x.x etc.)
	// These would be caught by the embedded IPv4 part — handle the common case
	const ipv4Mapped = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
	if (ipv4Mapped) {
		return isPrivateOrReservedIp(ipv4Mapped[1]);
	}

	return false;
}

// ─── resolve ─────────────────────────────────────────────────────────────────

type JobRow = {
	id: number;
	company_id: number;
	status: string;
	created_at: string;
};

type CompanyRow = {
	id: number;
	name: string;
	url: string | null;
	url_host: string | null;
};

/**
 * Resolve stage: establish the Resolved Identity for a job.
 *
 * - Computes and stores the 36-month search window
 * - If URL provided: fetch homepage (SSRF-guarded), extract title + social handles
 * - If name only: cascade heuristic → LLM → degraded
 * - Transitions job to 'searching' on completion
 */
export async function resolve(db: DatabaseSync, jobId: number): Promise<void> {
	// Fetch job + company
	const job = db
		.prepare(
			`SELECT j.id, j.company_id, j.status, j.created_at
       FROM jobs j WHERE j.id = ?`,
		)
		.get(jobId) as JobRow | undefined;

	if (!job) {
		throw new Error(`job not found: ${jobId}`);
	}

	const company = db
		.prepare("SELECT id, name, url, url_host FROM companies WHERE id = ?")
		.get(job.company_id) as CompanyRow | undefined;

	if (!company) {
		throw new Error(`company not found: ${job.company_id}`);
	}

	// ─── Compute and store the 36-month window ──────────────────────────────
	// created_at from SQLite is "YYYY-MM-DD HH:MM:SS" — take date portion only
	const createdDateOnly = job.created_at.slice(0, 10);
	const { windowStart, windowEnd } = computeWindow(createdDateOnly);

	db.prepare(
		"UPDATE jobs SET window_start = ?, window_end = ? WHERE id = ?",
	).run(windowStart, windowEnd, jobId);

	// ─── Resolution cascade ─────────────────────────────────────────────────

	if (company.url) {
		// URL-provided path
		await resolveFromUrl(db, jobId, company);
	} else {
		// Name-only path: heuristic → LLM → degraded
		await resolveFromName(db, jobId, company);
	}

	// ─── Transition to searching ─────────────────────────────────────────────
	transition(db, jobId, "searching");
}

// ─── resolveFromUrl ───────────────────────────────────────────────────────────

async function resolveFromUrl(
	db: DatabaseSync,
	jobId: number,
	company: CompanyRow,
): Promise<void> {
	// company.url is guaranteed non-null when this path is taken (url-provided job)
	const url = company.url ?? "";

	// Keep the given host as own domain regardless of fetch outcome
	let ownDomain: string;
	try {
		ownDomain = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
	} catch {
		ownDomain = url;
	}

	// SSRF guard
	const safe = await isSafeUrl(url);
	if (!safe) {
		db.prepare(
			`UPDATE jobs SET
        resolved_domains = ?,
        resolution_provenance = 'url_provided'
       WHERE id = ?`,
		).run(JSON.stringify([ownDomain]), jobId);

		addWarning(
			db,
			jobId,
			"homepage fetch failed — social handles not scraped, own-channel exclusion is domain-only",
		);
		return;
	}

	// Fetch with timeout, redirect cap, and 1MB read cap
	let html: string | null = null;
	let resolvedName: string | null = null;
	let handles: string[] = [];
	const finalDomain = ownDomain;

	try {
		html = await fetchHomepage(url);
	} catch {
		// Fetch failed — keep given domain, warn
	}

	if (html === null) {
		db.prepare(
			`UPDATE jobs SET
        resolved_domains = ?,
        resolution_provenance = 'url_provided'
       WHERE id = ?`,
		).run(JSON.stringify([ownDomain]), jobId);

		addWarning(
			db,
			jobId,
			"homepage fetch failed — social handles not scraped, own-channel exclusion is domain-only",
		);
		return;
	}

	// Extract title
	const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
	if (titleMatch) {
		resolvedName = titleMatch[1].trim() || null;
	}

	// Extract social handles
	handles = extractHandles(html);

	// Update job with resolved identity
	db.prepare(
		`UPDATE jobs SET
      resolved_name = ?,
      resolved_domains = ?,
      resolved_handles = ?,
      resolution_provenance = 'url_provided'
     WHERE id = ?`,
	).run(
		resolvedName,
		JSON.stringify([finalDomain]),
		JSON.stringify(handles),
		jobId,
	);
}

// ─── fetchHomepage ────────────────────────────────────────────────────────────

const MAX_REDIRECTS = 3;
const MAX_BODY_BYTES = 1024 * 1024; // 1 MB

/**
 * Fetch a homepage URL with SSRF guard on each redirect hop, 5s timeout,
 * redirect cap of 3, and 1MB response cap.
 *
 * Returns HTML string on success, throws on any failure.
 */
async function fetchHomepage(startUrl: string): Promise<string> {
	let currentUrl = startUrl;
	let hopsLeft = MAX_REDIRECTS;

	while (true) {
		const signal = AbortSignal.timeout(5000);
		const res = await fetch(currentUrl, { redirect: "manual", signal });

		// Follow redirects manually so we can SSRF-check each hop
		if (res.status >= 300 && res.status < 400) {
			const location = res.headers.get("location");
			if (!location || hopsLeft === 0) {
				throw new Error("redirect limit reached or missing location header");
			}

			// Resolve relative redirects
			const nextUrl = new URL(location, currentUrl).href;

			// SSRF check on the redirect target
			const safe = await isSafeUrl(nextUrl);
			if (!safe) {
				throw new Error(`redirect target failed SSRF check: ${nextUrl}`);
			}

			currentUrl = nextUrl;
			hopsLeft -= 1;
			continue;
		}

		if (!res.ok) {
			throw new Error(`HTTP ${res.status} fetching ${currentUrl}`);
		}

		// Read body up to 1MB
		if (!res.body) {
			throw new Error("no response body");
		}

		let bodyBytes = 0;
		const chunks: Uint8Array[] = [];
		for await (const chunk of res.body as AsyncIterable<Uint8Array>) {
			bodyBytes += chunk.length;
			if (bodyBytes > MAX_BODY_BYTES) break;
			chunks.push(chunk);
		}

		const bytes = new Uint8Array(chunks.reduce((acc, c) => acc + c.length, 0));
		let offset = 0;
		for (const chunk of chunks) {
			bytes.set(chunk, offset);
			offset += chunk.length;
		}

		return new TextDecoder().decode(bytes);
	}
}

// ─── resolveFromName ─────────────────────────────────────────────────────────

async function resolveFromName(
	db: DatabaseSync,
	jobId: number,
	company: CompanyRow,
): Promise<void> {
	const name = company.name;

	// Step 1: Tavily search for top-5 candidates
	const client = tavily({ apiKey: process.env.TAVILY_API_KEY ?? "" });
	let candidates: CandidatePage[] = [];

	try {
		const result = await client.search(`${name} official website`, {
			maxResults: TAVILY_MAX_RESULTS,
			searchDepth: TAVILY_SEARCH_DEPTH,
			topic: TAVILY_TOPIC,
		});

		candidates = (result.results ?? []).map((r) => ({
			title: r.title ?? "",
			url: r.url,
		}));
	} catch {
		// Tavily failed — proceed to degraded
		db.prepare(
			"UPDATE jobs SET resolution_provenance = 'none' WHERE id = ?",
		).run(jobId);
		addWarning(
			db,
			jobId,
			"no homepage identified — own-channel exclusion is LLM-only",
		);
		return;
	}

	// Step 2: Heuristic pick
	const heuristicUrl = pickHomepage(candidates, name);
	if (heuristicUrl !== null) {
		await applyResolvedHomepage(db, jobId, heuristicUrl, "heuristic");
		return;
	}

	// Step 3: LLM fallback (only when heuristic finds nothing)
	if (candidates.length > 0) {
		const llmIndex = await callLlmForHomepage(candidates, name);
		if (llmIndex !== null && llmIndex < candidates.length) {
			const llmUrl = candidates[llmIndex].url;
			await applyResolvedHomepage(db, jobId, llmUrl, "llm");
			addWarning(db, jobId, "homepage identified with low confidence — verify");
			return;
		}
	}

	// Step 4: Degraded — no homepage identified
	db.prepare("UPDATE jobs SET resolution_provenance = 'none' WHERE id = ?").run(
		jobId,
	);
	addWarning(
		db,
		jobId,
		"no homepage identified — own-channel exclusion is LLM-only",
	);
}

// ─── applyResolvedHomepage ────────────────────────────────────────────────────

type Provenance = "url_provided" | "heuristic" | "llm" | "none";

async function applyResolvedHomepage(
	db: DatabaseSync,
	jobId: number,
	homepageUrl: string,
	provenance: Provenance,
): Promise<void> {
	let domain: string;
	try {
		domain = new URL(homepageUrl).hostname.toLowerCase().replace(/^www\./, "");
	} catch {
		domain = homepageUrl;
	}

	let resolvedName: string | null = null;
	let handles: string[] = [];

	// Try to fetch the homepage for title + handles (best-effort, non-fatal)
	const safe = await isSafeUrl(homepageUrl);
	if (safe) {
		try {
			const html = await fetchHomepage(homepageUrl);
			const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
			if (titleMatch) {
				resolvedName = titleMatch[1].trim() || null;
			}
			handles = extractHandles(html);
		} catch {
			// Best-effort — ignore fetch failures here
		}
	}

	db.prepare(
		`UPDATE jobs SET
      resolved_name = ?,
      resolved_domains = ?,
      resolved_handles = ?,
      resolution_provenance = ?
     WHERE id = ?`,
	).run(
		resolvedName,
		JSON.stringify([domain]),
		JSON.stringify(handles),
		provenance,
		jobId,
	);
}

// ─── callLlmForHomepage ───────────────────────────────────────────────────────

const HAIKU_MODEL = "claude-haiku-4-5";

/**
 * Ask Claude Haiku to pick the best homepage from a closed list of candidates.
 *
 * Returns the 0-based index of the chosen candidate, or null if "none".
 * Constrained to structured output — the model can only pick from the list.
 */
async function callLlmForHomepage(
	candidates: CandidatePage[],
	companyName: string,
): Promise<number | null> {
	const anthropic = new Anthropic({
		apiKey: process.env.ANTHROPIC_API_KEY ?? "",
	});

	const candidateList = candidates
		.map((c, i) => `${i}: ${c.url} — ${c.title}`)
		.join("\n");

	const prompt = `Which of the following search results is the official homepage for the company "${companyName}"? Reply with ONLY a JSON object matching the schema. If none are the company's official homepage, use "none".

Candidates:
${candidateList}

Respond with JSON: {"candidate_index": <0-${candidates.length - 1} or "none">}`;

	try {
		const response = await anthropic.messages.create({
			max_tokens: 64,
			messages: [{ content: prompt, role: "user" }],
			model: HAIKU_MODEL,
		});

		const text =
			response.content[0]?.type === "text" ? response.content[0].text : "";

		// Parse JSON response
		const parsed = JSON.parse(text.trim()) as {
			candidate_index: number | "none";
		};

		if (parsed.candidate_index === "none") {
			return null;
		}

		const idx = Number(parsed.candidate_index);
		if (Number.isInteger(idx) && idx >= 0 && idx < candidates.length) {
			return idx;
		}
	} catch {
		// LLM call failed — return null (will fall through to degraded)
	}

	return null;
}
