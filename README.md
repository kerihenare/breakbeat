# Breakbeat

Breakbeat is a local web app that finds and organizes third-party coverage of a company from the last 36 months. Give it a company name and/or homepage URL, and it runs a background pipeline that fans out ~18 parallel Tavily searches, filters results with deterministic heuristics, deduplicates by normalized URL and title collapse, and then runs a single batched Claude Haiku classification pass to sort surviving results into News, Trade Publications, Press Releases, Podcasts, Blog Posts, Newsletters, Social Posts, and Other. The job page assembles in real time via HTMX polling, so you can watch coverage accumulate section by section as the pipeline runs. Everything is stored in a local SQLite database — no auth, no hosting, no build step.

## Setup

```bash
nvm use                       # Node v26 (.nvmrc)
pnpm install
cp .env.example .env          # then set ANTHROPIC_API_KEY + TAVILY_API_KEY
pnpm dev                      # http://localhost:3000
pnpm test                     # unit tests, no network
pnpm db:reset                 # fresh demo
```

## Docs

- [`docs/0-brief.md`](docs/0-brief.md) — original exercise brief
- [`docs/1-spec.md`](docs/1-spec.md) — design spec: architecture, pipeline, trade-offs (source of truth)
- [`docs/2-plan.md`](docs/2-plan.md) — implementation plan with checkbox-tracked tasks
- [`docs/3-writeup.md`](docs/3-writeup.md) — approach, trade-offs, out-of-scope, next steps
- [`docs/4-transcript.md`](docs/4-transcript.md) — agent transcript of the implementation session
- [`CONTEXT.md`](CONTEXT.md) — domain glossary (Job, Result, Exclusion, Collapse, etc.)
