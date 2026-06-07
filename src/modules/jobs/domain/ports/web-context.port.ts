export const WEB_CONTEXT = Symbol("WEB_CONTEXT");

export type ContextHit = {
	title: string;
	url: string;
};

/** A web search used to gather extra company context (Google Programmable Search). */
export interface WebContext {
	search(query: string, limit: number): Promise<ContextHit[]>;
	isConfigured(): boolean;
}
