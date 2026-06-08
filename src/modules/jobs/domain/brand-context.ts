/**
 * A compact, prompt-ready description of what a company actually is — sourced
 * from the BrandFetch Brand Context API (or composed from the Brand API company
 * fields + Google context as a fallback). Stored on the Resolved Identity and
 * consumed by the Verify and Classify stages to anchor entity disambiguation.
 */
export type BrandContext = {
	description: string;
	industry: string | null;
	aliases: string[];
};

/** Render a BrandContext as compact lines for an LLM prompt; omits empty parts. */
export function brandContextToText(context: BrandContext): string {
	const lines = [context.description.trim()];
	if (context.industry) lines.push(`Industry: ${context.industry}`);
	if (context.aliases.length > 0) {
		lines.push(`Also known as: ${context.aliases.join(", ")}`);
	}
	return lines.join("\n");
}
