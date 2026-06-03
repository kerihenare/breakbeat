import type { DatabaseSync } from "node:sqlite";
import { normalizeHost } from "../filter/normalize.ts";

// ─── Types ─────────────────────────────────────────────────────────────────

export type CompanyRow = {
	id: number;
	name: string;
	url: string | null;
	url_host: string | null;
	created_at: string;
};

// ─── findOrCreateCompany ───────────────────────────────────────────────────

/**
 * Resolve or create a company row using the three-case identity rule (spec §1.2):
 *
 * 1. **URL provided** → normalize the host; look up by `url_host`.
 *    - Found by host → return that row (name is just a display label, ignored for matching).
 *    - NOT found by host → try name match → if found, backfill `url`/`url_host` → return it.
 *    - Still no match → insert a new row.
 *
 * 2. **Name only** → match on `LOWER(TRIM(name)) = LOWER(TRIM(:name))`.
 *    - Found → return it.
 *    - Not found → insert a new row.
 *
 * The `name` stored on insert is always `name.trim()`.
 */
export function findOrCreateCompany(
	db: DatabaseSync,
	name: string,
	url?: string,
): CompanyRow {
	const trimmedName = name.trim();

	if (url !== undefined && url !== "") {
		const host = normalizeHost(url);

		// Case 1a: look up by url_host
		const byHost = db
			.prepare("SELECT * FROM companies WHERE url_host = ?")
			.get(host) as CompanyRow | undefined;

		if (byHost) {
			return byHost;
		}

		// Case 1b: try name match; backfill url/url_host if found
		const byName = db
			.prepare(
				"SELECT * FROM companies WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))",
			)
			.get(trimmedName) as CompanyRow | undefined;

		if (byName) {
			db.prepare("UPDATE companies SET url = ?, url_host = ? WHERE id = ?").run(
				url,
				host,
				byName.id,
			);
			return db
				.prepare("SELECT * FROM companies WHERE id = ?")
				.get(byName.id) as CompanyRow;
		}

		// Case 1c: insert new row
		db.prepare(
			"INSERT INTO companies (name, url, url_host) VALUES (?, ?, ?)",
		).run(trimmedName, url, host);

		return db
			.prepare("SELECT * FROM companies WHERE id = last_insert_rowid()")
			.get() as CompanyRow;
	}

	// Case 2: name-only
	const byName = db
		.prepare("SELECT * FROM companies WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))")
		.get(trimmedName) as CompanyRow | undefined;

	if (byName) {
		return byName;
	}

	// Insert name-only row
	db.prepare("INSERT INTO companies (name) VALUES (?)").run(trimmedName);

	return db
		.prepare("SELECT * FROM companies WHERE id = last_insert_rowid()")
		.get() as CompanyRow;
}
