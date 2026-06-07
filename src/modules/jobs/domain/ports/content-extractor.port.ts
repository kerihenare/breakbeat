export const CONTENT_EXTRACTOR = Symbol("CONTENT_EXTRACTOR");

/** Pulls page content for Result URLs (Tavily Extract). Best-effort. */
export interface ContentExtractor {
	/** Returns a map of URL → extracted text. Missing URLs simply aren't keyed. */
	extract(urls: string[]): Promise<Map<string, string>>;
	isConfigured(): boolean;
}
