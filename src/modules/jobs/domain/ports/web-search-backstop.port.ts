import type { SearchHit } from "./search-provider.port";

export const WEB_SEARCH_BACKSTOP = Symbol("WEB_SEARCH_BACKSTOP");

/** A natural-language web search used as an accuracy backstop alongside Tavily. */
export interface WebSearchBackstop {
	search(naturalQuery: string): Promise<SearchHit[]>;
	isConfigured(): boolean;
}
