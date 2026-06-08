import { Injectable } from "@nestjs/common";
import { type TavilySearchOptions, tavily } from "@tavily/core";
import { AppConfigService } from "../../../../shared/config/app-config.service";
import type {
	SearchHit,
	SearchProvider,
} from "../../domain/ports/search-provider.port";
import type { SearchQuery } from "../../domain/services/search-queries";

function hostOf(url: string): string {
	try {
		return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
	} catch {
		return url;
	}
}

@Injectable()
export class TavilySearch implements SearchProvider {
	constructor(private readonly config: AppConfigService) {}

	isConfigured(): boolean {
		return Boolean(this.config.get("TAVILY_API_KEY"));
	}

	async search(query: SearchQuery): Promise<SearchHit[]> {
		const apiKey = this.config.get("TAVILY_API_KEY");
		if (!apiKey) return [];
		const client = tavily({ apiKey });
		const options: TavilySearchOptions = {
			excludeDomains: query.options.excludeDomains,
			maxResults: query.options.maxResults,
			searchDepth: query.options.searchDepth,
			topic: query.options.topic,
			...(query.options.startDate
				? { startDate: query.options.startDate }
				: {}),
			...(query.options.endDate ? { endDate: query.options.endDate } : {}),
			...(query.options.timeRange
				? { timeRange: query.options.timeRange }
				: {}),
		};
		const response = await client.search(query.query, options);
		const hits: SearchHit[] = [];
		for (const hit of response.results ?? []) {
			if (!hit.url) continue;
			hits.push({
				content: hit.content ?? null,
				publishedDate: hit.publishedDate || null,
				score: hit.score ?? null,
				sourceDomain: hostOf(hit.url),
				title: hit.title ?? "",
				url: hit.url,
			});
		}
		return hits;
	}
}
