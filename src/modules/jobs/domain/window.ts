// The 36-month search window, computed once per Job and stored, so every later
// date filter reads the same bounds. Date-only, UTC.
export type SearchWindow = {
	readonly start: string; // ISO date (YYYY-MM-DD)
	readonly end: string; // ISO date (YYYY-MM-DD)
};

const WINDOW_MONTHS = 36;

function toIsoDate(d: Date): string {
	return d.toISOString().slice(0, 10);
}

/**
 * Compute the window: end = `now` (date-only, UTC), start = end minus 36
 * calendar months. Month-end overflow follows JS `Date` rollover semantics
 * (e.g. a non-existent 2021-02-29 rolls to 2021-03-01) — acceptable for a
 * 36-month recall window.
 */
export function computeWindow(now: Date): SearchWindow {
	const end = new Date(
		Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
	);
	const start = new Date(end);
	start.setUTCMonth(start.getUTCMonth() - WINDOW_MONTHS);
	return { end: toIsoDate(end), start: toIsoDate(start) };
}
