# Breakbeat

Breakbeat is a local web app that finds and organizes third-party coverage of a company from the last 36 months. Give it a company name and/or homepage URL, and it runs a background pipeline that fans out ~18 parallel Tavily searches, filters results with deterministic heuristics, deduplicates by normalized URL and title collapse, and then runs a single batched Claude Haiku classification pass to sort surviving results into News, Trade Publications, Press Releases, Podcasts, Blog Posts, Newsletters, Social Posts, and Other. The job page assembles in real time via HTMX polling, so you can watch coverage accumulate section by section as the pipeline runs. Everything is stored in a local SQLite database — no auth, no hosting, no build step.

## Approach

I wanted to fire-and-forget the execution of this project. So, I had Claude generate the initial spec from the brief and made revised the spec multiple times; Manually, by asking Claude to review, and by using Matt Pocock's great `/grill-with-docs` and `/grill-me` skills. I then repeated this process, generating the plan from the spec. This was all achieved using Opus 4.8 High. I then created a basic devcontainer to execute the implementation plan using Sonnet 4.6 High, started the implemenation and went to bed. There have been no further code changs since (only documentation). `superpowers` skills were used throughout to ensure quality spec, plan and implementation.

## Trade-offs

In order to build something in such a short time period, I kept things as simple as I could without dropping much in the way of quality. Instead of using a more capable database and queueing system, I used NodeJS's built-in SQLite. No time was allocated to design or visual formatting of outputs. I achieved the UI polling behaviour without requiring custom client-side JS by utilising HTMX. While I originally considered cost more heavily, I found it was incredibly cheap to run, so I removed requirements around cost.

## Next Steps
- Authentication
- Some basic design love
- Boot-time sweep to mark in-flight jobs `failed` so they stop polling forever.
- Cancel button for jobs
- Confirmation gate — an `awaiting_confirmation` state to verify the resolved company (if required) before spending search credits.
- Multi-provider search (if experimentation proves worthwhile)
- Semantic dedup — embedding-based clustering to catch paraphrased syndication that exact-title Collapse misses.
- Full-page content fetching — the biggest latency/quality lever left out; everything today runs on title and snippet alone.

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
- [`docs/3-implementation-prompt.md`](docs/3-implementation-promptiteup.md) — prompt provided to sonnet implementer
- [`docs/4-agent-writeup.md`](docs/4-agent-writeup.md) — approach, trade-offs, out-of-scope, next steps
- [`docs/5-agent-transcript.md`](docs/5-agent-transcript.md) — agent transcript of the implementation session
- [`CONTEXT.md`](CONTEXT.md) — domain glossary (Job, Result, Exclusion, Collapse, etc.)

Note: `4-agent-writeup.md` and `5-agent-transcript.md` were written by the implementation agent without request, based on `0-brief.md`.
