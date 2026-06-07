import type { DatabaseSync } from "node:sqlite";
import Anthropic from "@anthropic-ai/sdk";
import { addWarning } from "../jobs/queue.ts";
import type { ResolvedIdentity } from "../search/tavily.ts";
import { CLASSIFY_CAP, CLASSIFY_CHUNK_SIZE } from "../search/tavily.ts";

// ─── Re-export constants ──────────────────────────────────────────────────────

export { CLASSIFY_CAP, CLASSIFY_CHUNK_SIZE };

// ─── Model constant ───────────────────────────────────────────────────────────

export const CLASSIFY_MODEL = "claude-haiku-4-5";

// ─── Schema definitions ───────────────────────────────────────────────────────

const RESULT_ITEM_SCHEMA = {
	additionalProperties: false,
	properties: {
		confidence: {
			enum: ["high", "low"],
			type: "string",
		},
		content_type: {
			enum: [
				"news",
				"trade_publication",
				"blog_post",
				"press_release",
				"social_post",
				"newsletter",
				"podcast",
				"other",
			],
			type: "string",
		},
		exclude: {
			enum: ["none", "own_channel", "ecommerce_review", "aggregator"],
			type: "string",
		},
		id: { type: "integer" },
	},
	required: ["id", "content_type", "exclude", "confidence"],
	type: "object",
} as const;

const RESPONSE_SCHEMA = {
	additionalProperties: false,
	properties: {
		results: {
			items: RESULT_ITEM_SCHEMA,
			type: "array",
		},
	},
	required: ["results"],
	type: "object",
} as const;

// ─── Types ────────────────────────────────────────────────────────────────────

type ClassifyResultItem = {
	id: number;
	content_type:
		| "news"
		| "trade_publication"
		| "blog_post"
		| "press_release"
		| "social_post"
		| "newsletter"
		| "podcast"
		| "other";
	exclude: "none" | "own_channel" | "ecommerce_review" | "aggregator";
	confidence: "high" | "low";
};

type ResultRow = {
	id: number;
	title: string;
	snippet: string | null;
	url: string;
	source_domain: string;
};

// ─── buildPrompt ─────────────────────────────────────────────────────────────

/**
 * Pure function — builds the user-turn prompt for one classification chunk.
 *
 * Exported for testing.
 */
export function buildPrompt(
	results: ResultRow[],
	identity: ResolvedIdentity,
): string {
	const identityLines: string[] = [`Company name: ${identity.name}`];
	if (identity.domains.length > 0) {
		identityLines.push(`Own domains: ${identity.domains.join(", ")}`);
	}
	if (identity.handles.length > 0) {
		identityLines.push(
			`Own social handles/URLs: ${identity.handles.join(", ")}`,
		);
	}

	const resultLines = results
		.map((r) => {
			const snippetText = r.snippet ? r.snippet.trim() : "(no snippet)";
			return [
				`---`,
				`id: ${r.id}`,
				`title: ${r.title}`,
				`url: ${r.url}`,
				`source_domain: ${r.source_domain}`,
				`snippet: ${snippetText}`,
			].join("\n");
		})
		.join("\n");

	return `You are classifying third-party content about a company for a media monitoring tool.

COMPANY IDENTITY:
${identityLines.join("\n")}

CONTENT TYPE RULES:
- trade_publication = industry-niche outlet; if unsure between news and trade, choose news
- newsletter = email-first publication; Substack counts as newsletter
- other = explicit escape hatch for genuine type ambiguity; never force-fit
- "major" social posts = surfaced by search ranking (no engagement data available)
- own_channel means the company CONTROLS the surface (their profiles/accounts), NOT authorship
  - Wire-distributed press releases or company-bylined guest posts are NOT own_channel (they are on someone else's editorial surface)
  - Content about the company on any platform is in scope (not own_channel)
  - The company's own website, blog, LinkedIn page, X/Twitter handle, Substack ARE own_channel

EXCLUSION RULES:
- own_channel: content on a surface the company controls (their domain, their named social accounts)
- ecommerce_review: product comparison/review pages, pricing pages, alternative-finder sites
- aggregator: link aggregator sites (HN, Reddit, Slashdot, etc.)
- none: everything else (keep it)

For each result below, return: id, content_type, exclude ("none" if keeping), confidence ("high"/"low").
No reasoning. No additional fields.

RESULTS TO CLASSIFY:
${resultLines}`;
}

// ─── validateResultIds ────────────────────────────────────────────────────────

/**
 * Pure function — reconciles the IDs we sent against the IDs we got back.
 * The schema can't enforce that the model echoes our IDs, so this thin sanity
 * layer does: it keeps only recognized items (first occurrence wins on dups),
 * and reports both `rogue` IDs (returned but never sent) and `missing` IDs
 * (sent but never returned — those results would otherwise stay unclassified
 * with no trace). Callers add warnings as needed.
 *
 * Exported for testing.
 */
export function validateResultIds(
	sent: Set<number>,
	received: ClassifyResultItem[],
): { valid: ClassifyResultItem[]; rogue: number[]; missing: number[] } {
	const valid: ClassifyResultItem[] = [];
	const rogue: number[] = [];
	const seen = new Set<number>();
	for (const item of received) {
		if (!sent.has(item.id)) {
			rogue.push(item.id);
		} else if (!seen.has(item.id)) {
			seen.add(item.id);
			valid.push(item);
		}
		// Duplicate of an already-accepted id → ignore (first occurrence wins).
	}
	const missing = [...sent].filter((id) => !seen.has(id));
	return { missing, rogue, valid };
}

// ─── callModel ────────────────────────────────────────────────────────────────

/**
 * Call the Haiku model for one chunk of results.
 * Uses output_config.format (structured outputs) via the beta API.
 *
 * Returns the parsed array of ClassifyResultItem on success, throws on failure.
 */
async function callModel(
	client: Anthropic,
	prompt: string,
): Promise<ClassifyResultItem[]> {
	const response = await client.beta.messages.create({
		max_tokens: 4096,
		messages: [{ content: prompt, role: "user" }],
		model: CLASSIFY_MODEL,
		output_config: {
			format: {
				schema: RESPONSE_SCHEMA,
				type: "json_schema",
			},
		},
		system:
			"You are a precise content classifier. Return only valid JSON matching the requested schema. No markdown fences, no commentary.",
	});

	// Extract text content
	const textBlock = response.content.find((b) => b.type === "text");
	if (!textBlock || textBlock.type !== "text") {
		throw new Error("no text block in model response");
	}

	const parsed = JSON.parse(textBlock.text) as {
		results: ClassifyResultItem[];
	};
	if (!Array.isArray(parsed.results)) {
		throw new Error("model response missing results array");
	}

	return parsed.results;
}

// ─── applyChunkResults ────────────────────────────────────────────────────────

/**
 * Write one chunk's classification results back to the DB.
 */
function applyChunkResults(
	db: DatabaseSync,
	jobId: number,
	sentIds: Set<number>,
	items: ClassifyResultItem[],
): void {
	const { valid, rogue, missing } = validateResultIds(sentIds, items);

	if (rogue.length > 0) {
		addWarning(
			db,
			jobId,
			`classification returned ${rogue.length} unrecognized result ID(s): ${rogue.join(", ")} — discarded`,
		);
	}

	if (missing.length > 0) {
		addWarning(
			db,
			jobId,
			`classification omitted ${missing.length} result ID(s): ${missing.join(", ")} — left unclassified`,
		);
	}

	const excludeStmt = db.prepare(`
		UPDATE results
		SET status = 'excluded', exclusion_code = ?, exclusion_detail = 'LLM'
		WHERE id = ? AND job_id = ?
	`);

	const classifyStmt = db.prepare(`
		UPDATE results
		SET content_type = ?, confidence = ?
		WHERE id = ? AND job_id = ?
	`);

	for (const item of valid) {
		if (item.exclude !== "none") {
			excludeStmt.run(item.exclude, item.id, jobId);
		} else {
			classifyStmt.run(item.content_type, item.confidence, item.id, jobId);
		}
	}
}

// ─── classify ─────────────────────────────────────────────────────────────────

/**
 * Main classification function.
 *
 * 1. SELECTs all included results for the job (up to CLASSIFY_CAP)
 * 2. Chunks them into groups of CLASSIFY_CHUNK_SIZE
 * 3. Fires all chunks via Promise.allSettled
 * 4. Applies results: excluded if exclude !== 'none', else set content_type + confidence
 * 5. Chunk failure → addWarning; results stay unclassified (content_type NULL)
 * 6. ALL chunks fail → addWarning about backstop not running (still done_with_warnings, not failed)
 */
export async function classify(
	db: DatabaseSync,
	jobId: number,
	identity: ResolvedIdentity,
): Promise<void> {
	// Step 1: SELECT included results, fetching one past the cap so we can
	// detect (and report) overflow rather than silently truncating recall.
	const fetched = db
		.prepare(
			`SELECT id, title, snippet, url, source_domain
			 FROM results
			 WHERE job_id = ? AND status = 'included'
			 ORDER BY id
			 LIMIT ?`,
		)
		.all(jobId, CLASSIFY_CAP + 1) as ResultRow[];

	if (fetched.length === 0) {
		// Nothing to classify — not a warning, just a no-op
		return;
	}

	// Caps bound runaway failure, never recall — so hitting one is abnormal
	// and self-reports via done_with_warnings rather than dropping rows silently.
	const rows = fetched.slice(0, CLASSIFY_CAP);
	if (fetched.length > CLASSIFY_CAP) {
		addWarning(
			db,
			jobId,
			`classify cap reached: ${CLASSIFY_CAP} of more included results classified — remainder left unclassified`,
		);
	}

	// Step 2: Chunk into groups of CLASSIFY_CHUNK_SIZE
	const chunks: ResultRow[][] = [];
	for (let i = 0; i < rows.length; i += CLASSIFY_CHUNK_SIZE) {
		chunks.push(rows.slice(i, i + CLASSIFY_CHUNK_SIZE));
	}

	const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? "" });

	// Step 3: Fire all chunks concurrently
	const chunkPromises = chunks.map((chunk) => {
		const prompt = buildPrompt(chunk, identity);
		const sentIds = new Set(chunk.map((r) => r.id));
		return callModel(client, prompt).then((items) => ({ items, sentIds }));
	});

	const settled = await Promise.allSettled(chunkPromises);

	// Step 4 & 5: Apply results, warn on chunk failures
	let successCount = 0;
	let failCount = 0;

	for (const result of settled) {
		if (result.status === "fulfilled") {
			successCount++;
			applyChunkResults(db, jobId, result.value.sentIds, result.value.items);
		} else {
			failCount++;
			addWarning(
				db,
				jobId,
				`classification chunk failed: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
			);
		}
	}

	// Step 6: If ALL chunks failed, add the special backstop warning
	if (failCount > 0 && successCount === 0) {
		addWarning(
			db,
			jobId,
			"classification failed — results unclassified; own-channel backstop did not run",
		);
	}
}
