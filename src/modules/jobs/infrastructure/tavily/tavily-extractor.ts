import { Injectable, Logger } from "@nestjs/common";
import { tavily } from "@tavily/core";
import { AppConfigService } from "../../../../shared/config/app-config.service";
import type { ContentExtractor } from "../../domain/ports/content-extractor.port";

const EXTRACT_BATCH = 20; // Tavily Extract accepts up to 20 URLs per call.

@Injectable()
export class TavilyExtractor implements ContentExtractor {
	private readonly logger = new Logger(TavilyExtractor.name);

	constructor(private readonly config: AppConfigService) {}

	isConfigured(): boolean {
		return Boolean(this.config.get("TAVILY_API_KEY"));
	}

	async extract(urls: string[]): Promise<Map<string, string>> {
		const out = new Map<string, string>();
		const apiKey = this.config.get("TAVILY_API_KEY");
		if (!apiKey || urls.length === 0) return out;
		const client = tavily({ apiKey });

		for (let i = 0; i < urls.length; i += EXTRACT_BATCH) {
			const batch = urls.slice(i, i + EXTRACT_BATCH);
			try {
				const response = await client.extract(batch, {});
				for (const r of response.results ?? []) {
					if (r.url && r.rawContent) out.set(r.url, r.rawContent);
				}
			} catch (err) {
				// Best-effort: a failed batch degrades those results to their snippet.
				this.logger.warn(`extract batch failed: ${String(err)}`);
			}
		}
		return out;
	}
}
