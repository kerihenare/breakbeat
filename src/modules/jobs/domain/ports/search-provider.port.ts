import type { SearchQuery } from "../services/search-queries";

export const SEARCH_PROVIDER = Symbol("SEARCH_PROVIDER");

export type SearchHit = {
	url: string;
	title: string;
	content: string | null;
	sourceDomain: string;
	publishedDate: string | null;
};

export interface SearchProvider {
	search(query: SearchQuery): Promise<SearchHit[]>;
	isConfigured(): boolean;
}
