import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { createDb } from "../db.ts";
import { findOrCreateCompany } from "./company.ts";

describe("findOrCreateCompany", () => {
	// ─── URL-provided cases ────────────────────────────────────────────────────

	it("URL provided: creates a new company when no match exists", () => {
		const db = createDb(":memory:");
		const company = findOrCreateCompany(db, "Acme", "https://acme.com");
		assert.ok(company.id);
		assert.equal(company.name, "Acme");
		assert.equal(company.url, "https://acme.com");
		assert.equal(company.url_host, "acme.com");
		db.close();
	});

	it("URL provided: matches by url_host, ignores name on conflict", () => {
		const db = createDb(":memory:");
		// First insert: stored as "Globex"
		db.prepare(
			"INSERT INTO companies (name, url, url_host) VALUES (?, ?, ?)",
		).run("Globex", "https://globex.com", "globex.com");

		// Second call: "Acme" + same URL host -> should return Globex row unchanged
		const company = findOrCreateCompany(db, "Acme", "https://globex.com");
		assert.equal(company.name, "Globex");
		assert.equal(company.url_host, "globex.com");

		// Only one row in the table
		const count = db.prepare("SELECT COUNT(*) as n FROM companies").get() as {
			n: number;
		};
		assert.equal(count.n, 1);
		db.close();
	});

	it("URL provided: if no host match but name matches, backfills url/url_host", () => {
		const db = createDb(":memory:");
		// Pre-existing name-only row (no url/url_host)
		db.prepare("INSERT INTO companies (name) VALUES (?)").run("Acme");
		const existingRow = db
			.prepare("SELECT * FROM companies WHERE name = ?")
			.get("Acme") as { id: number; url: null; url_host: null };
		assert.equal(existingRow.url, null);

		// Now call with same name + a URL
		const company = findOrCreateCompany(db, "Acme", "https://acme.com");
		assert.equal(company.id, existingRow.id); // same row
		assert.equal(company.url, "https://acme.com"); // backfilled
		assert.equal(company.url_host, "acme.com"); // backfilled

		// Still only one row
		const count = db.prepare("SELECT COUNT(*) as n FROM companies").get() as {
			n: number;
		};
		assert.equal(count.n, 1);
		db.close();
	});

	it("URL provided: no match anywhere -> inserts new row", () => {
		const db = createDb(":memory:");
		db.prepare("INSERT INTO companies (name) VALUES (?)").run("Other Corp");

		const company = findOrCreateCompany(db, "Acme", "https://acme.com");
		assert.ok(company.id);
		assert.equal(company.name, "Acme");
		assert.equal(company.url_host, "acme.com");

		const count = db.prepare("SELECT COUNT(*) as n FROM companies").get() as {
			n: number;
		};
		assert.equal(count.n, 2);
		db.close();
	});

	it("URL provided with www. prefix: normalizes host for lookup", () => {
		const db = createDb(":memory:");
		db.prepare(
			"INSERT INTO companies (name, url, url_host) VALUES (?, ?, ?)",
		).run("Acme", "https://acme.com", "acme.com");

		const company = findOrCreateCompany(
			db,
			"Acme",
			"https://www.acme.com/about",
		);
		assert.equal(company.url_host, "acme.com"); // matched via normalized host
		const count = db.prepare("SELECT COUNT(*) as n FROM companies").get() as {
			n: number;
		};
		assert.equal(count.n, 1);
		db.close();
	});

	// ─── Name-only cases ───────────────────────────────────────────────────────

	it("name only: returns existing company matched by lowercase-trimmed name", () => {
		const db = createDb(":memory:");
		db.prepare("INSERT INTO companies (name) VALUES (?)").run("Acme Corp");

		const company = findOrCreateCompany(db, "  Acme Corp  ");
		assert.equal(company.name, "Acme Corp");

		const count = db.prepare("SELECT COUNT(*) as n FROM companies").get() as {
			n: number;
		};
		assert.equal(count.n, 1);
		db.close();
	});

	it("name only: case-insensitive name match", () => {
		const db = createDb(":memory:");
		db.prepare("INSERT INTO companies (name) VALUES (?)").run("Acme Corp");

		const company = findOrCreateCompany(db, "acme corp");
		assert.equal(company.name, "Acme Corp"); // returns existing row
		db.close();
	});

	it("name only: inserts new company when no name match", () => {
		const db = createDb(":memory:");

		const company = findOrCreateCompany(db, "Acme Corp");
		assert.ok(company.id);
		assert.equal(company.name, "Acme Corp");
		assert.equal(company.url, null);
		assert.equal(company.url_host, null);
		db.close();
	});

	it("name only: stores trimmed name on insert", () => {
		const db = createDb(":memory:");

		const company = findOrCreateCompany(db, "  Acme Corp  ");
		assert.equal(company.name, "Acme Corp");
		db.close();
	});

	// ─── URL-only submission (name derived from host) ──────────────────────────

	it("URL-only: when name equals normalizeHost result, still stores correctly", () => {
		const db = createDb(":memory:");
		const company = findOrCreateCompany(db, "acme.com", "https://acme.com");
		assert.equal(company.name, "acme.com");
		assert.equal(company.url_host, "acme.com");
		db.close();
	});

	// ─── Idempotency ──────────────────────────────────────────────────────────

	it("idempotent: same name + URL returns the same row on second call", () => {
		const db = createDb(":memory:");
		const first = findOrCreateCompany(db, "Acme", "https://acme.com");
		const second = findOrCreateCompany(db, "Acme", "https://acme.com");
		assert.equal(first.id, second.id);
		db.close();
	});
});
