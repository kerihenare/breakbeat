import { brandContextToText } from "../brand-context";
import type { ResolvedIdentity } from "../resolved-identity";

export const VERIFY_MODEL = "claude-haiku-4-5";
export const VERIFY_CAP = 400;
export const VERIFY_CHUNK_SIZE = 50;

export type VerifyDecisionRaw = "match" | "mismatch" | "uncertain";

export type VerifyInput = {
	id: string;
	title: string;
	url: string;
	sourceDomain: string;
	snippet: string | null;
};

// Closed-enum JSON schema for Anthropic structured outputs. No free-text field
// (the prompt-injection echo channel). `id` is echoed back for reconciliation.
export const VERIFY_RESPONSE_SCHEMA = {
	additionalProperties: false,
	properties: {
		results: {
			items: {
				additionalProperties: false,
				properties: {
					confidence: { enum: ["high", "low"], type: "string" },
					decision: {
						enum: ["match", "mismatch", "uncertain"],
						type: "string",
					},
					id: { type: "string" },
				},
				required: ["id", "decision", "confidence"],
				type: "object",
			},
			type: "array",
		},
	},
	required: ["results"],
	type: "object",
} as const;

export type VerifyVerdictRaw = {
	id: string;
	decision: VerifyDecisionRaw;
	confidence: "high" | "low";
};

/** Pure: build the user-turn prompt for one verification chunk. */
export function buildVerifyPrompt(
	inputs: VerifyInput[],
	identity: ResolvedIdentity,
): string {
	const identityLines = [`Company name: ${identity.name}`];
	if (identity.domains.length > 0) {
		identityLines.push(`Own domains: ${identity.domains.join(", ")}`);
	}
	if (identity.context) {
		identityLines.push(
			`What this company is: ${brandContextToText(identity.context)}`,
		);
	}
	if (identity.negativeMatches.length > 0) {
		identityLines.push(
			`Different companies with similar names (NOT the target): ${identity.negativeMatches.join(", ")}`,
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
				`snippet: ${r.snippet ? r.snippet.trim().slice(0, 1000) : "(no snippet)"}`,
			].join("\n"),
		)
		.join("\n");

	return `You are verifying whether each search result is genuinely about a specific company, for a media monitoring tool.

COMPANY IDENTITY:
${identityLines.join("\n")}

DECISION RULES — for each result decide whether it is about ${identity.name} (the company described above), NOT a different company that merely shares the name:
- "match": clearly about ${identity.name}.
- "mismatch": clearly about a DIFFERENT entity (e.g. one of the similar-named companies, a person, a generic word). Use confidence "high" only when you are certain.
- "uncertain": you cannot tell from the title/snippet/url.
Judge only from the fields given. Do not assume.

For each result below, return: id (echo it exactly), decision, confidence ("high"/"low").
No reasoning. No additional fields.

RESULTS TO VERIFY:
${resultLines}`;
}
