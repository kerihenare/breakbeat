import { brandContextToText } from "../brand-context";
import type { ResolvedIdentity } from "../resolved-identity";

export const CLASSIFY_MODEL = "claude-haiku-4-5";
export const CLASSIFY_CAP = 400;
export const CLASSIFY_CHUNK_SIZE = 50;

export type ClassifyExclude =
	| "none"
	| "own_channel"
	| "ecommerce_review"
	| "aggregator";

export type ClassifyInput = {
	id: string;
	title: string;
	url: string;
	sourceDomain: string;
	content: string | null;
};

// JSON schema for Anthropic structured outputs (constrained decoding). Closed
// enums are the audit trail; no free-text reasoning field (prompt-injection
// echo channel). `id` is a string (UUID).
export const RESPONSE_SCHEMA = {
	additionalProperties: false,
	properties: {
		results: {
			items: {
				additionalProperties: false,
				properties: {
					confidence: { enum: ["high", "low"], type: "string" },
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
					id: { type: "string" },
				},
				required: ["id", "content_type", "exclude", "confidence"],
				type: "object",
			},
			type: "array",
		},
	},
	required: ["results"],
	type: "object",
} as const;

/** Pure: build the user-turn prompt for one classification chunk. */
export function buildClassifyPrompt(
	inputs: ClassifyInput[],
	identity: ResolvedIdentity,
): string {
	const identityLines = [`Company name: ${identity.name}`];
	if (identity.domains.length > 0) {
		identityLines.push(`Own domains: ${identity.domains.join(", ")}`);
	}
	if (identity.handles.length > 0) {
		identityLines.push(
			`Own social handles/URLs: ${identity.handles.join(", ")}`,
		);
	}
	if (identity.negativeMatches.length > 0) {
		identityLines.push(
			`Other (different) companies to disambiguate against: ${identity.negativeMatches.join(", ")}`,
		);
	}
	if (identity.context) {
		identityLines.push(
			`What this company is: ${brandContextToText(identity.context)}`,
		);
	}

	const resultLines = inputs
		.map((r) =>
			[
				"---",
				`id: ${r.id}`,
				`title: ${r.title}`,
				`url: ${r.url}`,
				`source_domain: ${r.sourceDomain}`,
				`content: ${r.content ? r.content.trim().slice(0, 2000) : "(no content)"}`,
			].join("\n"),
		)
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
  - Wire-distributed press releases or company-bylined guest posts are NOT own_channel
  - Content about the company on any platform is in scope (not own_channel)
  - The company's own website, blog, LinkedIn page, X/Twitter handle, Substack ARE own_channel
- Content that is actually about one of the "other companies" listed above, not ${identity.name}, should be classified honestly but is a candidate the reviewer may discard.

EXCLUSION RULES:
- own_channel: content on a surface the company controls
- ecommerce_review: product comparison/review pages, pricing pages, alternative-finder sites
- aggregator: link aggregator sites (HN, Reddit, Slashdot, etc.)
- none: everything else (keep it)

For each result below, return: id (echo it exactly), content_type, exclude ("none" if keeping), confidence ("high"/"low").
No reasoning. No additional fields.

RESULTS TO CLASSIFY:
${resultLines}`;
}

export type ClassifyVerdictRaw = {
	id: string;
	content_type: string;
	exclude: ClassifyExclude;
	confidence: "high" | "low";
};

/**
 * Reconcile sent vs received ids (the schema can't enforce the model echoes our
 * ids). First occurrence wins on dupes; reports rogue (returned not sent) and
 * missing (sent not returned) ids.
 */
export function validateResultIds<T extends { id: string }>(
	sent: Set<string>,
	received: T[],
): { valid: T[]; rogue: string[]; missing: string[] } {
	const valid: T[] = [];
	const rogue: string[] = [];
	const seen = new Set<string>();
	for (const item of received) {
		if (!sent.has(item.id)) {
			rogue.push(item.id);
		} else if (!seen.has(item.id)) {
			seen.add(item.id);
			valid.push(item);
		}
	}
	const missing = [...sent].filter((id) => !seen.has(id));
	return { missing, rogue, valid };
}
