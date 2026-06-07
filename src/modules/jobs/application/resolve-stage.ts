import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Job } from "../domain/job";
import {
	BRAND_DIRECTORY,
	type BrandDirectory,
} from "../domain/ports/brand-directory.port";
import { WEB_CONTEXT, type WebContext } from "../domain/ports/web-context.port";
import type {
	IdentityProvenance,
	ResolvedIdentity,
} from "../domain/resolved-identity";
import { normalizeHost } from "../domain/services/normalize";

const CONTEXT_HITS = 5;

/**
 * Real Resolve: establish the Resolved Identity from BrandFetch (+ Google
 * context, + similarly-named companies as negative matches). Best-effort
 * throughout — any missing signal degrades to a Warning, never a failure;
 * the reviewable list is the Job's purpose.
 */
@Injectable()
export class ResolveStage {
	private readonly logger = new Logger(ResolveStage.name);

	constructor(
		@Inject(BRAND_DIRECTORY) private readonly brands: BrandDirectory,
		@Inject(WEB_CONTEXT) private readonly web: WebContext,
	) {}

	async run(job: Job): Promise<void> {
		const domain =
			job.chosenDomain ??
			(job.homepageUrl ? normalizeHost(job.homepageUrl) : null);

		const domains: string[] = [];
		const handles: string[] = [];
		let name = job.companyName;
		const provenance: IdentityProvenance = domain ? "url_provided" : "none";

		if (domain) {
			domains.push(domain);
			if (this.brands.isConfigured()) {
				const profile = await this.brands.fetchProfile(domain);
				if (profile) {
					if (profile.domain && !domains.includes(profile.domain)) {
						domains.push(profile.domain);
					}
					handles.push(...profile.handles);
					if (profile.name) name = profile.name;
				} else {
					job.addWarning(
						`brand profile for ${domain} unavailable — proceeding with the domain only`,
					);
				}
			}
		} else {
			job.addWarning(
				"no homepage identified — own-channel exclusion is LLM-only",
			);
		}

		if (this.web.isConfigured() && domain) {
			const query = `"${job.companyName}" "${domain}" -site:${domain}`;
			const hits = await this.web.search(query, CONTEXT_HITS);
			if (hits.length > 0) {
				job.contextNote = hits.map((h) => `${h.title} — ${h.url}`).join("\n");
			} else {
				job.addWarning("no additional company context found");
			}
		}

		const negativeMatches = this.brands.isConfigured()
			? await this.collectNegativeMatches(job.companyName, domain)
			: [];

		const identity: ResolvedIdentity = {
			domains,
			handles,
			name,
			negativeMatches,
			provenance,
			window: job.window,
		};
		job.attachResolvedIdentity(identity);
		this.logger.log(
			`resolved ${job.id}: ${domains.length} domain(s), ${handles.length} handle(s), ${negativeMatches.length} negative match(es)`,
		);
	}

	private async collectNegativeMatches(
		companyName: string,
		chosenDomain: string | null,
	): Promise<string[]> {
		// Domains (not names) — the Search stage excludes these, and the Classify
		// stage uses them as negative context.
		const candidates = await this.brands.search(companyName);
		const domains = candidates
			.filter((c) => c.domain !== chosenDomain)
			.map((c) => c.domain);
		return [...new Set(domains)];
	}
}
