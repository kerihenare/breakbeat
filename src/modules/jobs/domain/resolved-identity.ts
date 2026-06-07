import type { SearchWindow } from "./window";

export type IdentityProvenance = "url_provided" | "heuristic" | "llm" | "none";

/**
 * The company name plus zero or more own domains and social handles, plus the
 * negative-match companies (similarly-named brands) used to suppress false
 * positives in Search and Classify. The anchor every later stage filters
 * against. Established per-Job by the Resolve stage (Slice 4).
 */
export type ResolvedIdentity = {
	readonly name: string;
	readonly domains: string[];
	readonly handles: string[];
	readonly window: SearchWindow;
	readonly provenance: IdentityProvenance;
	readonly negativeMatches: string[];
};
