import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS companies (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  url         TEXT,
  url_host    TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS jobs (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id             INTEGER NOT NULL REFERENCES companies(id),
  status                 TEXT NOT NULL DEFAULT 'pending' CHECK (status IN
    ('pending','resolving','searching','filtering','classifying',
     'done','failed','done_with_warnings')),
  window_start           TEXT,
  window_end             TEXT,
  resolved_name          TEXT,
  resolved_domains       TEXT NOT NULL DEFAULT '[]',
  resolved_handles       TEXT NOT NULL DEFAULT '[]',
  resolution_provenance  TEXT CHECK (resolution_provenance IN
    ('url_provided','heuristic','llm','none')),
  error                  TEXT,
  created_at             TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS warnings (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id     INTEGER NOT NULL REFERENCES jobs(id),
  message    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS results (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id           INTEGER NOT NULL REFERENCES jobs(id),
  url              TEXT NOT NULL,
  normalized_url   TEXT NOT NULL,
  title            TEXT NOT NULL,
  snippet          TEXT,
  source_domain    TEXT NOT NULL,
  published_date   TEXT,
  status           TEXT NOT NULL DEFAULT 'included' CHECK (status IN ('included','excluded')),
  exclusion_code   TEXT CHECK (exclusion_code IN
    ('own_channel','aggregator','ecommerce_review','out_of_window','duplicate')),
  exclusion_detail TEXT,
  content_type     TEXT CHECK (content_type IN
    ('news','trade_publication','blog_post','press_release',
     'social_post','newsletter','podcast','other')),
  confidence       TEXT CHECK (confidence IN ('high','low')),
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (job_id, normalized_url)
);
`;

export function createDb(path: string): DatabaseSync {
	const db = new DatabaseSync(path);
	db.exec("PRAGMA journal_mode = WAL");
	db.exec("PRAGMA foreign_keys = ON");
	db.exec(SCHEMA);
	return db;
}

let _db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
	if (_db !== null) {
		return _db;
	}
	const dataDir = join(process.cwd(), "data");
	mkdirSync(dataDir, { recursive: true });
	_db = createDb(join(dataDir, "breakbeat.db"));
	return _db;
}
