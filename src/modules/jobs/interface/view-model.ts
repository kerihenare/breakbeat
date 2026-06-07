import type { ContentType } from "../domain/content-type";
import type { ExclusionCode } from "../domain/exclusion";
import type { Job } from "../domain/job";
import type { Result } from "../domain/result";

type GroupKey = ContentType | "unclassified";

// Fixed section order by editorial weight (spec / CONTEXT.md).
const TYPE_ORDER: { key: GroupKey; label: string }[] = [
	{ key: "news", label: "News" },
	{ key: "trade_publication", label: "Trade publications" },
	{ key: "press_release", label: "Press releases" },
	{ key: "podcast", label: "Podcasts" },
	{ key: "blog_post", label: "Blog posts" },
	{ key: "newsletter", label: "Newsletters" },
	{ key: "social_post", label: "Social posts" },
	{ key: "other", label: "Other" },
	{ key: "unclassified", label: "Unclassified" },
];

const EXCLUSION_LABELS: Record<ExclusionCode, string> = {
	aggregator: "Aggregator",
	duplicate: "Duplicate",
	ecommerce_review: "Ecommerce / review",
	out_of_window: "Out of window",
	own_channel: "Own channel",
};

export type ResultItemView = {
	title: string;
	url: string;
	sourceDomain: string;
	publishedDate: string | null;
	contentType: string | null;
	confidence: string | null;
	exclusionCode: string | null;
	exclusionDetail: string | null;
};

export type JobView = {
	id: string;
	companyName: string;
	homepageUrl: string | null;
	status: string;
	isTerminal: boolean;
	provenance: string | null;
	window: { start: string; end: string };
	warnings: string[];
	error: string | null;
	counts: { returned: number; excluded: number; classified: number };
	groups: { key: string; label: string; items: ResultItemView[] }[];
	excluded: { code: string; label: string; items: ResultItemView[] }[];
};

function toItem(r: Result): ResultItemView {
	return {
		confidence: r.confidence,
		contentType: r.contentType,
		exclusionCode: r.exclusion?.code ?? null,
		exclusionDetail: r.exclusion?.detail ?? null,
		publishedDate: r.publishedDate,
		sourceDomain: r.sourceDomain,
		title: r.title,
		url: r.url,
	};
}

// Published desc; date-unknown sinks to the bottom.
function byDateDesc(a: ResultItemView, b: ResultItemView): number {
	if (a.publishedDate === b.publishedDate) return 0;
	if (a.publishedDate === null) return 1;
	if (b.publishedDate === null) return -1;
	return a.publishedDate < b.publishedDate ? 1 : -1;
}

export function buildJobView(job: Job, results: Result[]): JobView {
	const included = results.filter((r) => !r.isExcluded);
	const excluded = results.filter((r) => r.isExcluded);

	const groups = TYPE_ORDER.map(({ key, label }) => ({
		items: included
			.filter((r) => (r.contentType ?? "unclassified") === key)
			.map(toItem)
			.sort(byDateDesc),
		key,
		label,
	})).filter((g) => g.items.length > 0);

	const excludedByCode = new Map<string, ResultItemView[]>();
	for (const r of excluded) {
		const code = r.exclusion?.code ?? "duplicate";
		const list = excludedByCode.get(code) ?? [];
		list.push(toItem(r));
		excludedByCode.set(code, list);
	}
	const excludedGroups = [...excludedByCode.entries()].map(([code, items]) => ({
		code,
		items,
		label: EXCLUSION_LABELS[code as ExclusionCode] ?? code,
	}));

	return {
		companyName: job.companyName,
		counts: {
			classified: included.filter((r) => r.contentType !== null).length,
			excluded: excluded.length,
			returned: results.length,
		},
		error: job.error,
		excluded: excludedGroups,
		groups,
		homepageUrl: job.homepageUrl,
		id: job.id,
		isTerminal: job.isTerminal,
		provenance: job.provenance,
		status: job.status,
		warnings: job.warnings.map((w) => w.message),
		window: job.window,
	};
}
