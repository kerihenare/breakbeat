import { normalizeTitle } from "./normalize";

export type CollapseInput = {
	readonly id: string;
	readonly title: string;
	readonly publishedDate: string | null;
};

export type CollapseDecision = {
	readonly loserId: string;
	readonly winnerId: string;
};

const MIN_TITLE_LEN = 25;
const WINDOW_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

/**
 * Pure Collapse: fold near-duplicate titles into the earliest-published copy.
 * Operates over the supplied (still-included) rows and returns loser→winner
 * decisions; applying them to storage is the caller's job (Slice 6).
 *
 * Algorithm (ported from v1, made pure):
 *  1. Normalise titles; skip those < 25 chars.
 *  2. Group by normalised title; singletons are ignored.
 *  3. Split each group into dated / undated.
 *  4. Cluster dated rows anchor-on-earliest within a 14-day window (no chaining).
 *  5. Winner per cluster = anchor (earliest); the rest are losers.
 *  6. Undated rows: join iff ≤1 dated cluster (winner = that anchor, or the
 *     first-seen undated row when all-undated); with ≥2 clusters they stay.
 *
 * First-seen is the input array order, so callers should pass rows in a stable
 * (e.g. insertion) order.
 */
export function collapse(rows: CollapseInput[]): CollapseDecision[] {
	const decisions: CollapseDecision[] = [];
	const groups = new Map<string, CollapseInput[]>();

	for (const row of rows) {
		const norm = normalizeTitle(row.title);
		if (norm.length < MIN_TITLE_LEN) continue;
		const existing = groups.get(norm);
		if (existing === undefined) groups.set(norm, [row]);
		else existing.push(row);
	}

	for (const group of groups.values()) {
		if (group.length < 2) continue;

		const dated = group.filter((r) => r.publishedDate !== null);
		const undated = group.filter((r) => r.publishedDate === null);

		dated.sort(
			(a, b) =>
				new Date(a.publishedDate as string).getTime() -
				new Date(b.publishedDate as string).getTime(),
		);

		const clusters: CollapseInput[][] = [];
		for (const result of dated) {
			const t = new Date(result.publishedDate as string).getTime();
			let placed = false;
			for (const cluster of clusters) {
				const anchorTime = new Date(
					cluster[0].publishedDate as string,
				).getTime();
				if (t - anchorTime <= WINDOW_MS) {
					cluster.push(result);
					placed = true;
					break;
				}
			}
			if (!placed) clusters.push([result]);
		}

		for (const cluster of clusters) {
			if (cluster.length < 2) continue;
			const winner = cluster[0];
			for (let i = 1; i < cluster.length; i++) {
				decisions.push({ loserId: cluster[i].id, winnerId: winner.id });
			}
		}

		if (undated.length === 0) continue;
		if (clusters.length >= 2) continue; // ambiguous — undated stay included

		if (clusters.length === 1) {
			const winner = clusters[0][0];
			for (const u of undated) {
				decisions.push({ loserId: u.id, winnerId: winner.id });
			}
		} else {
			const winner = undated[0]; // all-undated group → first-seen wins
			for (let i = 1; i < undated.length; i++) {
				decisions.push({ loserId: undated[i].id, winnerId: winner.id });
			}
		}
	}

	return decisions;
}
