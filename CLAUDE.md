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

## Design Context

This project carries two root context files that define how Breakbeat looks and who it serves. **Read both before doing any UI work.**

- **`PRODUCT.md`** — strategy: register (`product`), users (in-house PR/comms pros), product purpose (name a company → aggregated, sourced public footprint, fast), brand personality, anti-references, and design principles.
- **`DESIGN.md`** — visual system, inherited from the live Drumbeat platform (app.drumbeathq.com): warm **newsprint** paper, **ink charcoal** type, a single **press-blue** accent, **FK Grotesk** sans, flat surfaces with hairline borders. Token primitives live in its YAML frontmatter; `.impeccable/design.json` holds the extended tokens and drop-in component snippets.

**Design principles:** results first · every claim is traceable · approachable density · get out of the way · obvious without a manual.

For any design, redesign, critique, or polish work, use the `/impeccable` skill — it reads these files automatically.


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

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:970c3bf2 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.

## Agent Context Profiles

The managed Beads block is task-tracking guidance, not permission to override repository, user, or orchestrator instructions.

- **Conservative (default)**: Use `bd` for task tracking. Do not run git commits, git pushes, or Dolt remote sync unless explicitly asked. At handoff, report changed files, validation, and suggested next commands.
- **Minimal**: Keep tool instruction files as pointers to `bd prime`; use the same conservative git policy unless active instructions say otherwise.
- **Team-maintainer**: Only when the repository explicitly opts in, agents may close beads, run quality gates, commit, and push as part of session close. A current "do not commit" or "do not push" instruction still wins.

## Session Completion

This protocol applies when ending a Beads implementation workflow. It is subordinate to explicit user, repository, and orchestrator instructions.

1. **File issues for remaining work** - Create beads for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Handle git/sync by active profile**:
   ```bash
   # Conservative/minimal/default: report status and proposed commands; wait for approval.
   git status

   # Team-maintainer opt-in only, unless current instructions forbid it:
   git pull --rebase
   bd dolt push
   git push
   git status
   ```
5. **Hand off** - Summarize changes, validation, issue status, and any blocked sync/commit/push step

**Critical rules:**
- Explicit user or orchestrator instructions override this Beads block.
- Do not commit or push without clear authority from the active profile or the current user request.
- If a required sync or push is blocked, stop and report the exact command and error.
<!-- END BEADS INTEGRATION -->
