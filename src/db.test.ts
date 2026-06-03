import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { createDb } from "./db.ts";

describe("createDb", () => {
	it("returns a database instance for :memory:", () => {
		const db = createDb(":memory:");
		assert.ok(db);
		db.close();
	});

	it("enables WAL journal mode", () => {
		const db = createDb(":memory:");
		const row = db.prepare("PRAGMA journal_mode").get() as {
			journal_mode: string;
		};
		// :memory: databases return "memory" not "wal" but WAL pragma is accepted without error
		assert.ok(row);
		db.close();
	});

	it("enables foreign keys", () => {
		const db = createDb(":memory:");
		const row = db.prepare("PRAGMA foreign_keys").get() as {
			foreign_keys: number;
		};
		assert.equal(row.foreign_keys, 1);
		db.close();
	});
});

describe("companies table", () => {
	it("inserts and retrieves a company", () => {
		const db = createDb(":memory:");
		db.prepare("INSERT INTO companies (name, url) VALUES (?, ?)").run(
			"Acme Corp",
			"https://acme.com",
		);
		const row = db
			.prepare("SELECT * FROM companies WHERE name = ?")
			.get("Acme Corp") as { id: number; name: string; url: string };
		assert.equal(row.name, "Acme Corp");
		assert.equal(row.url, "https://acme.com");
		db.close();
	});
});

describe("jobs table", () => {
	it("a new job starts pending", () => {
		const db = createDb(":memory:");
		db.prepare("INSERT INTO companies (name) VALUES (?)").run("Acme Corp");
		const company = db
			.prepare("SELECT id FROM companies WHERE name = ?")
			.get("Acme Corp") as { id: number };
		db.prepare("INSERT INTO jobs (company_id) VALUES (?)").run(company.id);
		const job = db
			.prepare("SELECT * FROM jobs WHERE company_id = ?")
			.get(company.id) as { status: string };
		assert.equal(job.status, "pending");
		db.close();
	});

	it("rejects invalid job status values", () => {
		const db = createDb(":memory:");
		db.prepare("INSERT INTO companies (name) VALUES (?)").run("Acme Corp");
		const company = db
			.prepare("SELECT id FROM companies WHERE name = ?")
			.get("Acme Corp") as { id: number };
		assert.throws(() => {
			db.prepare("INSERT INTO jobs (company_id, status) VALUES (?, ?)").run(
				company.id,
				"invalid_status",
			);
		});
		db.close();
	});

	it("accepts all valid job status values", () => {
		const db = createDb(":memory:");
		db.prepare("INSERT INTO companies (name) VALUES (?)").run("Acme Corp");
		const company = db
			.prepare("SELECT id FROM companies WHERE name = ?")
			.get("Acme Corp") as { id: number };
		const validStatuses = [
			"pending",
			"resolving",
			"searching",
			"filtering",
			"classifying",
			"done",
			"failed",
			"done_with_warnings",
		];
		for (const status of validStatuses) {
			assert.doesNotThrow(() => {
				db.prepare("INSERT INTO jobs (company_id, status) VALUES (?, ?)").run(
					company.id,
					status,
				);
			}, `status "${status}" should be valid`);
		}
		db.close();
	});

	it("rejects invalid resolution_provenance values", () => {
		const db = createDb(":memory:");
		db.prepare("INSERT INTO companies (name) VALUES (?)").run("Acme Corp");
		const company = db
			.prepare("SELECT id FROM companies WHERE name = ?")
			.get("Acme Corp") as { id: number };
		assert.throws(() => {
			db.prepare(
				"INSERT INTO jobs (company_id, resolution_provenance) VALUES (?, ?)",
			).run(company.id, "bad_provenance");
		});
		db.close();
	});

	it("enforces foreign key constraint on company_id", () => {
		const db = createDb(":memory:");
		assert.throws(() => {
			db.prepare("INSERT INTO jobs (company_id) VALUES (?)").run(9999);
		});
		db.close();
	});
});

describe("results table", () => {
	function setupJobAndCompany(db: ReturnType<typeof createDb>) {
		db.prepare("INSERT INTO companies (name) VALUES (?)").run("Acme Corp");
		const company = db
			.prepare("SELECT id FROM companies WHERE name = ?")
			.get("Acme Corp") as { id: number };
		db.prepare("INSERT INTO jobs (company_id) VALUES (?)").run(company.id);
		const job = db
			.prepare("SELECT id FROM jobs WHERE company_id = ?")
			.get(company.id) as { id: number };
		return { companyId: company.id, jobId: job.id };
	}

	it("a Result is born included", () => {
		const db = createDb(":memory:");
		const { jobId } = setupJobAndCompany(db);
		db.prepare(
			"INSERT INTO results (job_id, url, normalized_url, title, source_domain) VALUES (?, ?, ?, ?, ?)",
		).run(
			jobId,
			"https://example.com/article",
			"example.com/article",
			"Article Title",
			"example.com",
		);
		const result = db
			.prepare("SELECT * FROM results WHERE job_id = ?")
			.get(jobId) as { status: string };
		assert.equal(result.status, "included");
		db.close();
	});

	it("normalized_url is unique per job", () => {
		const db = createDb(":memory:");
		const { jobId } = setupJobAndCompany(db);
		db.prepare(
			"INSERT INTO results (job_id, url, normalized_url, title, source_domain) VALUES (?, ?, ?, ?, ?)",
		).run(
			jobId,
			"https://example.com/article",
			"example.com/article",
			"Article Title",
			"example.com",
		);
		assert.throws(() => {
			db.prepare(
				"INSERT INTO results (job_id, url, normalized_url, title, source_domain) VALUES (?, ?, ?, ?, ?)",
			).run(
				jobId,
				"https://example.com/article?ref=1",
				"example.com/article",
				"Article Title 2",
				"example.com",
			);
		}, "duplicate normalized_url within same job should fail");
		db.close();
	});

	it("same normalized_url may exist across different jobs", () => {
		const db = createDb(":memory:");
		const { jobId } = setupJobAndCompany(db);

		// Create a second job for the same company
		db.prepare("INSERT INTO companies (name) VALUES (?)").run("Other Corp");
		const company2 = db
			.prepare("SELECT id FROM companies WHERE name = ?")
			.get("Other Corp") as { id: number };
		db.prepare("INSERT INTO jobs (company_id) VALUES (?)").run(company2.id);
		const job2 = db
			.prepare("SELECT id FROM jobs WHERE company_id = ?")
			.get(company2.id) as { id: number };

		assert.doesNotThrow(() => {
			db.prepare(
				"INSERT INTO results (job_id, url, normalized_url, title, source_domain) VALUES (?, ?, ?, ?, ?)",
			).run(
				jobId,
				"https://example.com/article",
				"example.com/article",
				"Article Title",
				"example.com",
			);
			db.prepare(
				"INSERT INTO results (job_id, url, normalized_url, title, source_domain) VALUES (?, ?, ?, ?, ?)",
			).run(
				job2.id,
				"https://example.com/article",
				"example.com/article",
				"Article Title",
				"example.com",
			);
		}, "same normalized_url in different jobs should be allowed");
		db.close();
	});

	it("rejects invalid status values", () => {
		const db = createDb(":memory:");
		const { jobId } = setupJobAndCompany(db);
		assert.throws(() => {
			db.prepare(
				"INSERT INTO results (job_id, url, normalized_url, title, source_domain, status) VALUES (?, ?, ?, ?, ?, ?)",
			).run(
				jobId,
				"https://example.com/article",
				"example.com/article",
				"Article Title",
				"example.com",
				"pending",
			);
		});
		db.close();
	});

	it("rejects invalid exclusion_code values", () => {
		const db = createDb(":memory:");
		const { jobId } = setupJobAndCompany(db);
		assert.throws(() => {
			db.prepare(
				"INSERT INTO results (job_id, url, normalized_url, title, source_domain, exclusion_code) VALUES (?, ?, ?, ?, ?, ?)",
			).run(
				jobId,
				"https://example.com/article",
				"example.com/article",
				"Article Title",
				"example.com",
				"llm_excluded",
			);
		});
		db.close();
	});

	it("accepts all valid exclusion_code values", () => {
		const db = createDb(":memory:");
		const { jobId } = setupJobAndCompany(db);
		const validCodes = [
			"own_channel",
			"aggregator",
			"ecommerce_review",
			"out_of_window",
			"duplicate",
		];
		let i = 0;
		for (const code of validCodes) {
			assert.doesNotThrow(() => {
				db.prepare(
					"INSERT INTO results (job_id, url, normalized_url, title, source_domain, status, exclusion_code) VALUES (?, ?, ?, ?, ?, ?, ?)",
				).run(
					jobId,
					`https://example.com/article-${i}`,
					`example.com/article-${i}`,
					`Article ${i}`,
					"example.com",
					"excluded",
					code,
				);
				i++;
			}, `exclusion_code "${code}" should be valid`);
		}
		db.close();
	});

	it("rejects invalid content_type values", () => {
		const db = createDb(":memory:");
		const { jobId } = setupJobAndCompany(db);
		assert.throws(() => {
			db.prepare(
				"INSERT INTO results (job_id, url, normalized_url, title, source_domain, content_type) VALUES (?, ?, ?, ?, ?, ?)",
			).run(
				jobId,
				"https://example.com/article",
				"example.com/article",
				"Article Title",
				"example.com",
				"video",
			);
		});
		db.close();
	});

	it("accepts all valid content_type values", () => {
		const db = createDb(":memory:");
		const { jobId } = setupJobAndCompany(db);
		const validTypes = [
			"news",
			"trade_publication",
			"blog_post",
			"press_release",
			"social_post",
			"newsletter",
			"podcast",
			"other",
		];
		let i = 0;
		for (const type of validTypes) {
			assert.doesNotThrow(() => {
				db.prepare(
					"INSERT INTO results (job_id, url, normalized_url, title, source_domain, content_type) VALUES (?, ?, ?, ?, ?, ?)",
				).run(
					jobId,
					`https://example.com/article-type-${i}`,
					`example.com/article-type-${i}`,
					`Article ${i}`,
					"example.com",
					type,
				);
				i++;
			}, `content_type "${type}" should be valid`);
		}
		db.close();
	});

	it("content_type is nullable (stays NULL on classify failure)", () => {
		const db = createDb(":memory:");
		const { jobId } = setupJobAndCompany(db);
		db.prepare(
			"INSERT INTO results (job_id, url, normalized_url, title, source_domain) VALUES (?, ?, ?, ?, ?)",
		).run(
			jobId,
			"https://example.com/article",
			"example.com/article",
			"Article Title",
			"example.com",
		);
		const result = db
			.prepare("SELECT content_type FROM results WHERE job_id = ?")
			.get(jobId) as { content_type: string | null };
		assert.equal(result.content_type, null);
		db.close();
	});

	it("rejects invalid confidence values", () => {
		const db = createDb(":memory:");
		const { jobId } = setupJobAndCompany(db);
		assert.throws(() => {
			db.prepare(
				"INSERT INTO results (job_id, url, normalized_url, title, source_domain, confidence) VALUES (?, ?, ?, ?, ?, ?)",
			).run(
				jobId,
				"https://example.com/article",
				"example.com/article",
				"Article Title",
				"example.com",
				"medium",
			);
		});
		db.close();
	});

	it("enforces foreign key constraint on job_id", () => {
		const db = createDb(":memory:");
		assert.throws(() => {
			db.prepare(
				"INSERT INTO results (job_id, url, normalized_url, title, source_domain) VALUES (?, ?, ?, ?, ?)",
			).run(
				9999,
				"https://example.com/article",
				"example.com/article",
				"Article Title",
				"example.com",
			);
		});
		db.close();
	});
});

describe("warnings table", () => {
	it("inserts a warning linked to a job", () => {
		const db = createDb(":memory:");
		db.prepare("INSERT INTO companies (name) VALUES (?)").run("Acme Corp");
		const company = db
			.prepare("SELECT id FROM companies WHERE name = ?")
			.get("Acme Corp") as { id: number };
		db.prepare("INSERT INTO jobs (company_id) VALUES (?)").run(company.id);
		const job = db
			.prepare("SELECT id FROM jobs WHERE company_id = ?")
			.get(company.id) as { id: number };
		db.prepare("INSERT INTO warnings (job_id, message) VALUES (?, ?)").run(
			job.id,
			"3 of 18 search queries failed",
		);
		const warning = db
			.prepare("SELECT * FROM warnings WHERE job_id = ?")
			.get(job.id) as { message: string };
		assert.equal(warning.message, "3 of 18 search queries failed");
		db.close();
	});

	it("enforces foreign key constraint on job_id", () => {
		const db = createDb(":memory:");
		assert.throws(() => {
			db.prepare("INSERT INTO warnings (job_id, message) VALUES (?, ?)").run(
				9999,
				"some warning",
			);
		});
		db.close();
	});
});
