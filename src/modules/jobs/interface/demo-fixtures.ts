import type { ContentType } from "../domain/content-type";
import type { ExclusionCode } from "../domain/exclusion";
import { Job } from "../domain/job";
import type { Clock } from "../domain/ports/clock.port";
import type { IdGenerator } from "../domain/ports/id-generator.port";
import type { ResolvedIdentity } from "../domain/resolved-identity";
import { Result } from "../domain/result";
import { normalizeUrl } from "../domain/services/normalize";
import { computeWindow } from "../domain/window";

type DemoHit = {
	title: string;
	url: string;
	domain: string;
	date: string | null;
	type: ContentType | null;
	exclude?: { code: ExclusionCode; detail: string };
	verification?: "verified" | "uncertain";
};

// Realistic fixtures (DESIGN-BRIEF §10) so the Clipping Desk is viewable
// without API keys. Dev-only.
const DEMO_HITS: DemoHit[] = [
	{
		date: "2025-11-02",
		domain: "bloomberg.com",
		title: "Acme raises $40M Series B to expand its platform",
		type: "news",
		url: "https://bloomberg.com/news/acme-series-b",
	},
	{
		date: "2025-09-18",
		domain: "reuters.com",
		title: "Acme names new chief executive amid rapid growth",
		type: "news",
		url: "https://reuters.com/business/acme-ceo",
	},
	{
		date: "2025-07-30",
		domain: "theverge.com",
		title: "Inside Acme's bet on developer tooling",
		type: "news",
		url: "https://theverge.com/acme-developer-tooling",
	},
	{
		date: "2025-06-11",
		domain: "tradetechtoday.com",
		title: "Acme partners with industry body on data standards",
		type: "trade_publication",
		url: "https://tradetechtoday.com/acme-data-standards",
	},
	{
		date: "2025-10-05",
		domain: "prnewswire.com",
		title: "Acme announces general availability of its v3 platform",
		type: "press_release",
		url: "https://prnewswire.com/acme-v3-ga",
	},
	{
		date: "2025-08-21",
		domain: "businesswire.com",
		title: "Acme appoints new VP of Engineering",
		type: "press_release",
		url: "https://businesswire.com/acme-vp-eng",
	},
	{
		date: "2025-05-14",
		domain: "podcasts.example.fm",
		title: "Acme's founder on building in public",
		type: "podcast",
		url: "https://podcasts.example.fm/acme-founder",
	},
	{
		date: "2025-09-01",
		domain: "devblog.example.io",
		title: "Why we switched to Acme: an engineering retrospective",
		type: "blog_post",
		url: "https://devblog.example.io/switched-to-acme",
	},
	{
		date: "2025-04-22",
		domain: "medium.com",
		title: "A field guide to Acme's recent pricing changes",
		type: "blog_post",
		url: "https://medium.com/@analyst/acme-pricing",
		verification: "uncertain",
	},
	{
		date: "2025-10-19",
		domain: "substack.com",
		title: "This week in fintech: Acme, regulation, and more",
		type: "newsletter",
		url: "https://substack.com/fintechweekly/acme",
	},
	{
		date: "2025-11-03",
		domain: "x.com",
		title: "Big news from Acme today — congrats to the team",
		type: "social_post",
		url: "https://x.com/journalist/status/999",
	},
	{
		date: "2025-03-10",
		domain: "example.org",
		title: "Acme mentioned in a roundup of notable startups",
		type: "other",
		url: "https://example.org/notable-startups-2025",
	},
	{
		date: "2025-10-01",
		domain: "acme.com",
		exclude: { code: "own_channel", detail: "acme.com" },
		title: "Acme blog: our roadmap for the next year",
		type: null,
		url: "https://acme.com/blog/roadmap",
	},
	{
		date: "2025-08-02",
		domain: "reddit.com",
		exclude: { code: "aggregator", detail: "reddit.com" },
		title: "Discussion: anyone using Acme in production?",
		type: null,
		url: "https://reddit.com/r/devtools/acme",
	},
	{
		date: "2025-09-12",
		domain: "acmefoods.com",
		exclude: { code: "off_topic", detail: "LLM" },
		title: "Acme Foods recalls a product line",
		type: null,
		url: "https://acmefoods.com/recall",
	},
];

/** Build a finished demo Job + Results (not yet persisted). */
export function buildDemoJob(
	ids: IdGenerator,
	clock: Clock,
): { job: Job; results: Result[] } {
	const now = clock.now();
	const window = computeWindow(now);
	const jobId = ids.next();
	const identity: ResolvedIdentity = {
		domains: ["acme.com"],
		handles: ["https://x.com/acme"],
		name: "Acme",
		negativeMatches: ["acmefoods.com"],
		provenance: "url_provided",
		window,
	};
	const job = new Job(jobId, "Acme", "https://acme.com", window, now, {
		chosenDomain: "acme.com",
		resolvedIdentity: identity,
		status: "done_with_warnings",
		warnings: [{ message: "demo data — no live search was performed" }],
	});

	const results = DEMO_HITS.map((hit) => {
		if (hit.exclude) {
			return new Result(
				ids.next(),
				jobId,
				hit.url,
				normalizeUrl(hit.url),
				hit.title,
				hit.domain,
				hit.date,
				null,
				null,
				{
					exclusion: { code: hit.exclude.code, detail: hit.exclude.detail },
					status: "excluded",
				},
			);
		}
		const result = new Result(
			ids.next(),
			jobId,
			hit.url,
			normalizeUrl(hit.url),
			hit.title,
			hit.domain,
			hit.date,
			null,
			null,
			{
				confidence: "high",
				contentType: hit.type,
			},
		);
		if (hit.verification) {
			result.setVerification(hit.verification);
		}
		return result;
	});

	return { job, results };
}
