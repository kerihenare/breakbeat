import { Injectable, Logger } from "@nestjs/common";
import { z } from "zod";
import { AppConfigService } from "../../../../shared/config/app-config.service";
import type {
	ContextHit,
	WebContext,
} from "../../domain/ports/web-context.port";

const GoogleItem = z.object({
	link: z.string(),
	title: z.string().optional(),
});
const GoogleResponse = z.object({
	items: z.array(GoogleItem).optional(),
});

@Injectable()
export class GoogleContext implements WebContext {
	private readonly logger = new Logger(GoogleContext.name);

	constructor(private readonly config: AppConfigService) {}

	isConfigured(): boolean {
		return (
			Boolean(this.config.get("GOOGLE_API_KEY")) &&
			Boolean(this.config.get("GOOGLE_CX"))
		);
	}

	async search(query: string, limit: number): Promise<ContextHit[]> {
		const key = this.config.get("GOOGLE_API_KEY");
		const cx = this.config.get("GOOGLE_CX");
		if (!key || !cx) return [];
		const num = Math.min(Math.max(1, limit), 10); // Custom Search caps at 10
		try {
			const url =
				`https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(key)}` +
				`&cx=${encodeURIComponent(cx)}&num=${num}&q=${encodeURIComponent(query)}`;
			const res = await fetch(url);
			if (!res.ok) {
				this.logger.warn(`google context: HTTP ${res.status}`);
				return [];
			}
			const parsed = GoogleResponse.safeParse(await res.json());
			if (!parsed.success) return [];
			return (parsed.data.items ?? [])
				.slice(0, num)
				.map((i) => ({ title: i.title ?? i.link, url: i.link }));
		} catch (err) {
			this.logger.warn(`google context failed: ${String(err)}`);
			return [];
		}
	}
}
