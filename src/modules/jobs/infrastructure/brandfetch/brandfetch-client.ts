import { Injectable, Logger } from "@nestjs/common";
import { z } from "zod";
import { AppConfigService } from "../../../../shared/config/app-config.service";
import type {
	BrandCandidate,
	BrandDirectory,
	BrandProfile,
} from "../../domain/ports/brand-directory.port";

const SearchItem = z.object({
	domain: z.string(),
	icon: z.string().optional(),
	name: z.string().optional(),
});
const SearchResponse = z.array(SearchItem);

const BrandLink = z.object({ name: z.string(), url: z.string() });
const BrandResponse = z.object({
	domain: z.string().optional(),
	links: z.array(BrandLink).optional(),
	name: z.string().optional(),
});

const HANDLE_PLATFORMS = new Set([
	"twitter",
	"linkedin",
	"facebook",
	"instagram",
	"youtube",
	"github",
]);

@Injectable()
export class BrandfetchClient implements BrandDirectory {
	private readonly logger = new Logger(BrandfetchClient.name);

	constructor(private readonly config: AppConfigService) {}

	isConfigured(): boolean {
		return (
			Boolean(this.config.get("BRANDFETCH_CLIENT_ID")) &&
			Boolean(this.config.get("BRANDFETCH_API_KEY"))
		);
	}

	async search(query: string): Promise<BrandCandidate[]> {
		const clientId = this.config.get("BRANDFETCH_CLIENT_ID");
		if (!clientId) return [];
		try {
			const res = await fetch(
				`https://api.brandfetch.io/v2/search/${encodeURIComponent(query)}?c=${encodeURIComponent(clientId)}`,
			);
			if (!res.ok) {
				this.logger.warn(`brand search ${query}: HTTP ${res.status}`);
				return [];
			}
			const parsed = SearchResponse.safeParse(await res.json());
			if (!parsed.success) return [];
			return parsed.data
				.filter((i) => i.domain)
				.map((i) => ({
					domain: i.domain,
					iconUrl: i.icon ?? null,
					name: i.name ?? i.domain,
				}));
		} catch (err) {
			this.logger.warn(`brand search ${query} failed: ${String(err)}`);
			return [];
		}
	}

	async fetchProfile(domain: string): Promise<BrandProfile | null> {
		const apiKey = this.config.get("BRANDFETCH_API_KEY");
		if (!apiKey) return null;
		try {
			const res = await fetch(
				`https://api.brandfetch.io/v2/brands/${encodeURIComponent(domain)}`,
				{ headers: { Authorization: `Bearer ${apiKey}` } },
			);
			if (!res.ok) {
				this.logger.warn(`brand profile ${domain}: HTTP ${res.status}`);
				return null;
			}
			const parsed = BrandResponse.safeParse(await res.json());
			if (!parsed.success) return null;
			const handles = (parsed.data.links ?? [])
				.filter((l) => HANDLE_PLATFORMS.has(l.name.toLowerCase()))
				.map((l) => l.url);
			return {
				domain: parsed.data.domain ?? domain,
				handles,
				name: parsed.data.name ?? domain,
			};
		} catch (err) {
			this.logger.warn(`brand profile ${domain} failed: ${String(err)}`);
			return null;
		}
	}
}
