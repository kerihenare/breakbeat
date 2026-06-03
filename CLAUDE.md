# Breakbeat

## The Task

Build a basic web app that:

1. Accepts a company name and/or homepage URL.
2. Starts a **background job** that finds content about the company from the **last 36 months**.
3. Shows job status while running.
4. Presents results in an easily reviewable list.

**Include**:
- news articles
- trade publications
- blog posts
- press releases
- major social posts
- newsletters
- podcasts

**Exclude**:
- product review/comparison pages
- ecommerce pages
- the company's own channels (their website, blog, LinkedIn, etc.)
- link aggregator sites.

## Constraints & Evaluation Criteria

- No authentication, hosting, or CI/CD required — local-only experience.
- Must be clone → add API keys to `.env` → run locally.
- Evaluated on: product judgement, technical architecture, agent-assisted execution, handling ambiguity, search/retrieval strategy, background job design, result quality and deduplication, clear local setup, sensible trade-offs, security and cost awareness.
- Deliverables alongside code: a write-up (approach, trade-offs, next steps) and an agent transcript — both can live in this repo.

## Stack

Node.js v26 (`.nvmrc`) running TypeScript natively via type stripping — **erasable syntax only**: no `enum`, `namespace`, or constructor parameter properties. Express + Nunjucks (autoescape on) + HTMX polling; SQLite via built-in `node:sqlite`; Tavily for search; Claude Haiku for classification; Biome for lint/format; pnpm as package manager.

## Key Documents

- `CONTEXT.md` — domain language; use its terms exactly (Job, Resolved Identity, Own Channel, Result, Exclusion, Collapse, Content Type, Warning, Angle Query)
- `docs/0-brief.md` — original exercise brief
- `docs/1-spec.md` — design spec (source of truth for architecture, pipeline stages, trade-offs)
- `docs/2-plan.md` — implementation plan (checkbox-tracked tasks; where the spec and plan disagree, the spec wins)

## Environment

Copy `.env.example` → `.env` and set `ANTHROPIC_API_KEY` and `TAVILY_API_KEY`. Keys load via `node --env-file-if-exists=.env` (no dotenv).

## Development Commands

```bash
pnpm install
pnpm dev          # run with --watch, loads .env
pnpm test         # native node --test runner (src/**/*.test.ts)
pnpm test:watch
pnpm lint:fix     # biome check --write
pnpm db:reset     # delete data/breakbeat.db
```

## Do not build
- authentication
- production deployment
- CI/CD
- complex crawling
- social media login/API integrations
- advanced NLP classification
- perfect coverage across all content types
