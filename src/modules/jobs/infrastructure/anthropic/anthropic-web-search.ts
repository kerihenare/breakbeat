import Anthropic from "@anthropic-ai/sdk";
import { Injectable } from "@nestjs/common";
import { AppConfigService } from "../../../../shared/config/app-config.service";
import type { SearchHit } from "../../domain/ports/search-provider.port";
import type { WebSearchBackstop } from "../../domain/ports/web-search-backstop.port";

/** Narrowed shape of a single result item inside a web_search_tool_result block. */
interface WebSearchResultItem {
	url: string;
	title: string;
	page_age: string | null;
	type: "web_search_result";
	encrypted_content: string;
}

/** Narrowed shape of a web_search_tool_result content block in the response. */
interface WebSearchToolResultBlock {
	type: "web_search_tool_result";
	content:
		| WebSearchResultItem[]
		| { type: "web_search_tool_result_error"; error_code: string };
}

function hostOf(url: string): string {
	try {
		return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
	} catch {
		return url;
	}
}

@Injectable()
export class AnthropicWebSearch implements WebSearchBackstop {
	constructor(private readonly config: AppConfigService) {}

	isConfigured(): boolean {
		return Boolean(this.config.get("ANTHROPIC_API_KEY"));
	}

	async search(naturalQuery: string): Promise<SearchHit[]> {
		const apiKey = this.config.get("ANTHROPIC_API_KEY");
		if (!apiKey) return [];

		const client = new Anthropic({ apiKey });

		try {
			const response = await client.messages.create({
				max_tokens: 1024,
				messages: [
					{ content: `Search the web for: ${naturalQuery}`, role: "user" },
				],
				model: "claude-haiku-4-5",
				tools: [
					{
						max_uses: 3,
						name: "web_search",
						type: "web_search_20250305",
					},
				],
			});

			const hits: SearchHit[] = [];
			for (const block of response.content) {
				if (block.type !== "web_search_tool_result") continue;
				const resultBlock = block as unknown as WebSearchToolResultBlock;
				if (!Array.isArray(resultBlock.content)) continue;
				for (const item of resultBlock.content) {
					if (!item.url) continue;
					hits.push({
						content: null,
						publishedDate: item.page_age ?? null,
						score: null,
						sourceDomain: hostOf(item.url),
						title: item.title ?? "",
						url: item.url,
					});
				}
			}
			return hits;
		} catch {
			return [];
		}
	}
}
