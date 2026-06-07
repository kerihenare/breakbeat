# Slice 8 — The Clipping Desk UI: Design Spec & Plan

**Bead:** `aglow-ti2.8` · **Date:** 2026-06-08 · Self-directed. Builds on 1–7. Contract: `DESIGN-BRIEF.md`, `DESIGN.md`, `PRODUCT.md`.

## Purpose
Lift the minimal Slice-3 templates onto the **Drumbeat "Clipping Desk" brand**: a two-pane split layout (search rail + results pane), Tailwind v4 theme from `DESIGN.md` tokens, three Lit Web Components (`bb-job-status`, `bb-result-filter`, `bb-sentiment-gauge`), HTMX flows, mocked sentiment, and a dev demo seed so a keyless clone can showcase the UI. WCAG 2.1 AA + `prefers-reduced-motion`.

## Client build pipeline
- **Tailwind v4** (`tailwindcss`+`@tailwindcss/cli`): `src/client/styles.css` (`@import "tailwindcss"` + `@theme` mapping the DESIGN.md tokens — newsprint/ink/press-blue scales, FK Grotesk stack w/ `system-ui` fallback, radii, spacing) → `public/app.css`. Scans `views/**` + `src/client/**`.
- **Lit + esbuild**: `src/client/components/index.ts` imports the three components → bundled ESM → `public/components.js`.
- `src/client/` is **excluded from the Nest/tsc build** (browser code; esbuild transpiles). Scripts: `build:css`, `build:js`, `build:client` (both); `dev` runs client build first; `build` includes it. Outputs in `public/` are git-ignored and rebuilt (commit the sources, not the artifacts).

## Layout (DESIGN-BRIEF §3)
`layout.njk` becomes the shell (newsprint bg, ink type, FK Grotesk; links app.css + components.js + htmx). `home.njk` = split: **rail** (≈320px: new-search form above selectable recent jobs, active job marked press-blue) + **results pane** (job header → sentiment gauge → filter tabs → grouped results → collapsed excluded). Below `lg` the rail collapses to a top bar. Empty state: calm "Name a company to start tracking its coverage".

## Web Components (DESIGN-BRIEF §5–6)
- `<bb-job-status status>` — **light DOM**; status chip, pulses while `running` (reduced-motion: static).
- `<bb-result-filter>` — **light DOM**; content-type tab row; toggles `.result-group` visibility client-side (instant, no round trip); roving tabindex + arrow keys; updates the active tab.
- `<bb-sentiment-gauge positive neutral negative>` — **shadow DOM** styled with Drumbeat CSS custom properties (`var(--color-*)` pierce shadow); accessible stacked bar + labelled counts; width animates on mount (reduced-motion: instant). Color never the sole carrier — counts + labels carry meaning.

## Sentiment (mocked, DESIGN-BRIEF §10)
The pipeline doesn't produce sentiment. The view-model assigns a **deterministic mock** per included Result (hash of id → positive/neutral/negative) and aggregates counts for the gauge. Isolated in one helper so a real sentiment pass swaps in cleanly; the section is removable without disturbing layout.

## Demo seed (keyless showcase)
Dev-only `GET /demo`: inserts a `done` Job with realistic fixtures (believable sources, dates in-window, spread across types + a few exclusions) so the Clipping Desk is viewable without API keys. Fixtures live in one module (`interface/demo-fixtures.ts`). Guarded off in production.

## Decisions
1. **Light DOM by default** (Tailwind utilities + HTMX targeting work); shadow DOM only for the gauge, styled via inherited CSS custom properties (DESIGN-BRIEF §6).
2. **Progressive enhancement:** form + job links + grouped results work without JS; components enhance (filter degrades to all-visible groups; status/gauge are additive).
3. **Mock sentiment in the view-model**, deterministic, single helper — honest about being mocked.
4. **Build artifacts git-ignored**; sources committed; README documents `pnpm build:client`.
5. **Honor the bans** (DESIGN.md §6): no SaaS gradient, no hero-metric block, no card grids, no border-left stripes, no gradient text, no nested cards.

## Testing / acceptance
- `pnpm build:client` produces `public/app.css` + `public/components.js`; `pnpm build` + lint + 111 tests stay green.
- View-model sentiment mock is deterministic (unit test).
- Live: `docker compose` + `/demo` → the Clipping Desk renders the split layout, grouped results, sentiment gauge, filter tabs, status chip; filter toggles groups; **Playwright screenshot** captured for visual verification.
- Keyboard path + `prefers-reduced-motion` honored; AA contrast (tokens already clear it).

## Out of scope
Real sentiment; virtualization (>300 items); the final write-up/README polish (Slice 9, though this slice updates README's client-build note).
