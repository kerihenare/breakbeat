<!-- Reconciled against the shipped Breakbeat client (src/client/styles.css @theme, the Lit components in src/client/components/, and the views/*.njk templates) on 2026-06-08, replacing the values originally sampled from the live Drumbeat platform. Tokens here are the ones the build actually ships. Re-run /impeccable document after any token or component change. -->
---
name: Breakbeat
description: A PR research tool that searches the web and aggregates a company's public footprint, on the Drumbeat brand.
colors:
  ink: "#292a2a"
  ink-soft: "#3f3e3e"
  ink-deep: "#0f1010"
  press-blue: "#1a8cd6"
  press-blue-deep: "#1071b3"
  focus-blue: "#46bbff"
  page-white: "#fdfdfc"
  newsprint: "#efe8e3"
  newsprint-muted: "#f7f3ef"
  newsprint-subtle: "#f3ece7"
  card-cream: "#fcfaf9"
  border-hair: "#ebe0d8"
  border-muted: "#d8cbc0"
  text-muted: "#5c5959"
  text-dimmed: "#6f6b6b"
  live-green: "#25b566"
  live-green-surface: "#bbf5d7"
  alert-coral: "#e85a68"
  alert-coral-surface: "#fec2c8"
  aether-gold: "#f0be0a"
typography:
  display:
    fontFamily: "FK Grotesk, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  title:
    fontFamily: "FK Grotesk, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  body:
    fontFamily: "FK Grotesk, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "FK Grotesk, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "normal"
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
  xl: "12px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  2xl: "48px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.page-white}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    padding: "8px 16px"
  button-primary-hover:
    backgroundColor: "{colors.ink-soft}"
    textColor: "{colors.page-white}"
  button-secondary:
    backgroundColor: "{colors.card-cream}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    padding: "8px 12px"
  button-secondary-hover:
    backgroundColor: "{colors.newsprint-subtle}"
    textColor: "{colors.ink}"
  input-text:
    backgroundColor: "{colors.page-white}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: "8px 12px"
  card:
    backgroundColor: "{colors.card-cream}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "8px 12px"
  status-chip:
    backgroundColor: "{colors.newsprint-subtle}"
    textColor: "{colors.ink}"
    typography: "{typography.mono}"
    rounded: "{rounded.full}"
    padding: "2px 10px"
  status-chip-done:
    backgroundColor: "{colors.live-green-surface}"
    textColor: "{colors.ink}"
  status-chip-alert:
    backgroundColor: "{colors.alert-coral-surface}"
    textColor: "{colors.ink}"
  filter-tab:
    backgroundColor: "transparent"
    textColor: "{colors.text-muted}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "4px 10px"
  filter-tab-active:
    textColor: "{colors.press-blue-deep}"
  warning-banner:
    backgroundColor: "{colors.alert-coral-surface}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    padding: "8px 12px"
---

# Design System: Breakbeat

## 1. Overview

**Creative North Star: "The Clipping Desk"**

Breakbeat is where a PR pro sits down, names a company, and watches its public footprint assemble itself, the modern descendant of the press-clipping desk where comms teams once pinned coverage to a board. The system inherits the Drumbeat platform's identity wholesale: warm **newsprint** paper, **ink charcoal** type, and a single press-room sans (FK Grotesk). The aesthetic is editorial and calm, not the cold blue-gray of generic SaaS. The paper is warm on purpose; it reads like a desk, not a dashboard.

This is a **product** surface, design serves the task. The aggregated results are the loudest thing on any screen; everything else (the search rail, filters, chrome) is quiet ink-on-paper that gets out of the way. The shipped layout is a two-column split on wide screens, a fixed 320px search rail on warm Newsprint Muted, then the results pane on Page White, collapsing to a single stacked column below `lg`. Color is **restrained**: the warm neutral ramp carries the surface, ink charcoal carries text and the one primary action, and a single **press blue** accent marks links, focus, and the live status signal, kept to a small fraction of any screen. Brand secondaries (green for done/live, coral for warnings, gold for low-confidence flags) appear only as semantic signals, never decoration.

It explicitly rejects three things, carried verbatim from PRODUCT.md: the **generic SaaS template** (no purple gradient, no hero-metric block, no endless identical icon-card grids); the **cluttered enterprise dashboard** (no dense gray everything-at-once legacy UI); and **heavy marketing flourish** (no scroll-jacking, oversized imagery, or decorative animation that delays the work).

**Key Characteristics:**
- Warm newsprint paper foundation with ink-charcoal type, editorial not corporate.
- One press-blue accent, used sparingly for action, focus, and live signals.
- A single humanist sans (FK Grotesk) carrying all hierarchy through weight and a fixed type scale.
- Flat surfaces, hairline borders, fast functional motion (no choreography).
- Results-first: the split layout puts the assembled readout front and centre; chrome recedes to the rail.

## 2. Colors

A warm newsprint neutral ramp anchored by ink charcoal, with a single press-blue accent and a small set of semantic brand signals. Tokens ship as Tailwind v4 `@theme` custom properties (`--color-*`) in `src/client/styles.css`, so the same values drive both the utility classes (`bg-newsprint`, `text-ink`) and the shadow-DOM Lit components (the properties inherit through the shadow boundary).

### Primary
- **Ink Charcoal** (`#292a2a`, token `ink`): The workhorse. Body text, headings, icons, and the single primary button fill. This is the "ink" the whole system is printed in.
- **Soft Ink** (`#3f3e3e`, token `ink-soft`): Primary button hover, slightly lifted ink for interactive states.
- **Deep Ink** (`#0f1010`, token `ink-deep`): The highest-emphasis text. In the shipped UI it carries the company name as the page subject.
- **Press Blue** (`#1a8cd6`, token `press-blue`): The one accent. Link colour, the active filter-tab border, and live signals. Used on ≤10% of any screen.
- **Deep Press Blue** (`#1071b3`, token `press-blue-deep`): Link hover, the running-status chip text, and the active filter-tab label, where stronger contrast against light surfaces matters.
- **Focus Blue** (`#46bbff`, token `focus-blue`): The global `:focus-visible` ring (`2px` outline, `2px` offset). The brighter blue reads clearly as a keyboard-focus signal against both paper and white.

### Secondary (semantic signals, never decoration)
- **Live Green** (`#25b566`, token `live-green`) on **Live Surface** (`#bbf5d7`, token `live-green-surface`): the `done` status chip, and the positive segment of the sentiment gauge.
- **Alert Coral** (`#e85a68`, token `alert-coral`) on **Coral Surface** (`#fec2c8`, token `alert-coral-surface`): the `done_with_warnings`/`failed` status chips, warning and error banners, and the negative sentiment segment. Always paired with a `⚠` glyph or a text label, never colour alone.
- **Aether Gold** (`#f0be0a`, token `aether-gold`): a rare flag. In the shipped UI it marks a Result's "low confidence" label, nothing else.

### Neutral (the newsprint ramp)
- **Page White** (`#fdfdfc`, token `page-white`): The cleanest base, used behind the densest reading (the results pane and input fills).
- **Newsprint** (`#efe8e3`, token `newsprint`): The signature `<body>` background. Warm paper that gives the product its desk-not-dashboard character.
- **Newsprint Muted** (`#f7f3ef`, token `newsprint-muted`): The search rail surface, a half-step off the page.
- **Newsprint Subtle** (`#f3ece7`, token `newsprint-subtle`): Hovered rows, the resting status chip, secondary-button hover.
- **Card Cream** (`#fcfaf9`, token `card-cream`): Result rows and selection buttons, a hair lighter than the paper so cards read as lifted without a shadow.
- **Border Hair** (`#ebe0d8`, token `border-hair`) / **Border Muted** (`#d8cbc0`, token `border-muted`): Hairline dividers and container edges (`border-hair`) and input strokes (`border-muted`). Depth comes from these, not from shadow.
- **Text Muted** (`#5c5959`, token `text-muted`) / **Text Dimmed** (`#6f6b6b`, token `text-dimmed`): Secondary and metadata text (dates, source domains, counts) and the neutral sentiment segment. Both clear ≥4.5:1 on paper and white.

### Named Rules
**The One Accent Rule.** Press blue is the only chromatic accent in the core UI; it lives on ≤10% of any screen. Its scarcity is what makes "this is a link / this is the active filter / this is live" legible. Semantic green, coral, and gold are signals, not accents, they appear only when they carry meaning.

**The Warm-On-Purpose Rule.** The newsprint background is a committed brand choice, not the AI warm-cream reflex. Never flatten it to a cool gray "to be safe," and never add a second warm-neutral family. The warmth is the brand; the variation is tonal (Newsprint → Newsprint Muted → Newsprint Subtle → Card Cream), not hue-shifted.

## 3. Typography

**Display Font:** FK Grotesk (with `system-ui` / `-apple-system` fallback)
**Body Font:** FK Grotesk (same family, lighter weights)
**Label/Mono Font:** `ui-monospace` system stack (for source domains, dates, counts)

**Character:** One humanist grotesque carries the entire system. Hierarchy comes from weight and a fixed scale, not from a second typeface, which keeps a data-dense PR readout calm and fast to scan. The scale is **fixed rem**, not fluid, this is a product surface viewed at consistent DPI inside a rail-and-pane layout, so a clamp-sized heading that shrinks in the column would read worse, not better. FK Grotesk is not bundled as a web font; the stack falls back to `system-ui` wherever it is not installed, so test hierarchy on a fallback face too.

### Hierarchy
- **Display** (600, `1.875rem` / `text-3xl`, line-height 1.2, `-0.025em`): The page subject, the searched company name in the job header. One per view.
- **Title** (600, `1.125rem` / `text-lg`, line-height 1.3, `-0.01em`): The largest section headings, the brand-candidate prompt, the recent-jobs and result-group context. Result-group headers step down to `1rem` semibold; the count-triad figures step up to `1.5rem` (`text-2xl`) semibold, three plain numbers, never a styled hero metric.
- **Body** (400, `1rem`, line-height 1.5): The default. Reading copy and Result titles. Cap prose measure at 65–75ch (`max-w-prose`).
- **Label** (500, `0.875rem` / `text-sm`): Buttons, field labels, filter tabs, secondary nav. Short uppercase section labels (Recent jobs, Sentiment) use this size with `tracking-wide`.
- **Mono** (400, `0.8125rem`): Source domains, dates, the search window, count labels, recent-job statuses, anything that benefits from a "machine data" texture. Shipped as the `.mono` class in Text Muted.

### Named Rules
**The One Family Rule.** FK Grotesk does all the work. No second display or body face. Mono appears only on machine data (domains, dates, counts), never on prose.

**The Short-Label Rule.** Uppercase is reserved for genuine short section labels of ≤4 words (Recent jobs, Sentiment), set in Label type with `tracking-wide`. It is never used on sentences, and never applied as a decorative eyebrow above every section, the two shipped uses earn their place by labelling a real list.

## 4. Elevation

The system is **flat by default**, and the shipped UI is flat everywhere: every surface uses `box-shadow: none`. Depth is built entirely from the tonal newsprint ramp and hairline borders. A Result row is Card Cream (`#fcfaf9`) sitting on the Page White pane with a `1px` Border Hair edge, so it reads as lifted without any drop shadow. The split layout's two columns are separated by a single `border-hair` rule, not a shadow. This keeps the surface calm and avoids the heavy, dated look the brand rejects.

Shadows are reserved for genuinely floating layers, overlays that escape the document flow (dropdowns, popovers, modals, toasts). None ship today; the vocabulary below is the standard for when one lands. They must be soft and diffuse, never the dark, tight shadow of a 2014 app.

### Shadow Vocabulary (forward standard; not yet instantiated)
- **Overlay** (`box-shadow: 0 8px 24px rgba(41, 42, 42, 0.12)`): Dropdowns, popovers, command menus. Soft, warm-tinted, ambient.
- **Modal** (`box-shadow: 0 16px 48px rgba(41, 42, 42, 0.18)`): Dialogs and full overlays that need to sit clearly above a dimmed backdrop.

### Named Rules
**The Flat-By-Default Rule.** Surfaces are flat at rest. A shadow means "this floats above the page." If an element isn't a true overlay, it gets a border and a tonal shift, not a shadow.

## 5. Components

The shipped UI is HTMX-driven Nunjucks templates (`views/*.njk`) with three Lit Web Components used only where HTMX can't reach: a live status chip, client-side filter tabs, and the sentiment gauge. Styling is Tailwind v4 utilities plus a small set of component classes in `src/client/styles.css`.

### Buttons
- **Shape:** Gently rounded (8px radius, `{rounded.lg}`).
- **Primary:** Ink Charcoal fill (`#292a2a`), Page White text, `8px 16px` padding (`px-4 py-2`), Label type (500, 0.875rem). The primary action ("Start search") is ink, not a colored button, colour is reserved for the accent.
- **Hover / Focus:** Background lifts to Soft Ink (`#3f3e3e`). Focus shows the global Focus Blue (`#46bbff`) `2px` ring, never a removed outline.
- **Secondary / Selection:** The brand-candidate picker buttons, Card Cream fill (`#fcfaf9`) with a `1px` Border Hair edge, `8px 12px` padding (`px-3 py-2`), Ink text, left-aligned; hover to Newsprint Subtle (`#f3ece7`). This is the real secondary affordance, a full-width tappable card-button, not a tinted pill.
- **Tertiary / Ghost:** Transparent fill, Text Muted, used for the filter tabs (see below) and the `← New search` back link.

### Inputs / Fields
- **Style:** Page White fill, `1px` Border Muted (`#d8cbc0`) stroke, 8px radius, `8px 12px` padding (`px-3 py-2`), Body type. Each input sits under a Label-type field label.
- **Focus:** The global Focus Blue (`#46bbff`) `2px` outline at `2px` offset; no glow theatrics.
- **The search front door** is two standard text fields, Company name and Homepage URL, in the rail. The URL field disambiguates which company is meant; a helper line ("Provide the URL for unambiguous results") sits below. The fields are standard size, the rail's placement, not extra chrome, gives them prominence.

### Cards / Containers
- **Result row:** 8px radius (`{rounded.lg}`), Card Cream (`#fcfaf9`) fill, `1px` Border Hair edge, `8px 12px` padding (`px-3 py-2`). A compact list item, the densest reusable surface. The Result title is a Body-weight link (Ink → Press Blue Deep on hover) that opens in a new tab with a `↗` glyph and a visually-hidden "(opens in a new tab)"; the source domain, date (or "date unknown"), and any low-confidence flag sit beneath in Mono.
- **Shadow Strategy:** None at rest (see Elevation). Lift is tonal + bordered.
- **Never nest cards.** A card inside a card is always wrong; use spacing, dividers, or tonal sections instead. Grouped Results live under plain `h3` headers inside the pane, not inside wrapper cards.

### Status Chip (Lit: `<bb-job-status>`)
A fully-rounded pill (`{rounded.full}`), `2px 10px` padding, Mono-scale text. Resting fill is Newsprint Subtle with a `1px` Border Hair edge. **State carries colour and a label, never colour alone:** `done` → Live Surface; `done_with_warnings`/`failed` → Coral Surface; running states (`resolving`, `searching`, `filtering`, `extracting`, `classifying`, `refining`) → Press Blue Deep text with a gentle `bb-pulse` opacity animation. `role="status"` + `aria-live="polite"` announce transitions; the pulse is suppressed under `prefers-reduced-motion`.

### Filter Tabs (Lit: `<bb-result-filter>`)
A horizontal `tablist` of ghost buttons (transparent, Text Muted, 6px radius, `4px 10px` padding). Hover gets a Newsprint Subtle wash. The active tab takes Press Blue Deep text with a `1px` Press Blue border. Roving tabindex + arrow-key navigation; filtering is instant and client-side (the full Result set ships with the job), and the groups degrade to all-visible without JS.

### Sentiment Gauge (Lit: `<bb-sentiment-gauge>`)
A single horizontal stacked bar (`0.75rem` tall, fully rounded, Border Hair edge on a Newsprint Muted track): Live Green positive, Text Dimmed neutral, Alert Coral negative. **Colour is never the sole carrier**, a labelled legend with a colour dot and an explicit count sits below, and the bar exposes `role="img"` with a full text `aria-label`. Segment widths animate on mount (`width 0.3s ease-out`), instant under `prefers-reduced-motion`.

### Count Triad
Three plain figures in the job header, returned · excluded · classified, each a `1.5rem` semibold number over a Mono label. Deliberately *not* a hero-metric block: no accent colour, no supporting deltas, no card. Three honest counts, evenly spaced.

### Warning / Error Banner
A full-width Coral Surface (`#fec2c8`) block, Ink text, 8px radius, `8px 12px` padding, prefixed with `⚠`. Errors and each Warning render as their own banner with `role="status"`. Colour plus the glyph plus the message, never colour alone.

### Signature Component: The Results Pane
The core surface is the assembled company readout in the right-hand pane: a job header (company name + status chip, provenance and search window in Mono, the count triad, then any warning banners), an optional sentiment gauge, the filter tablist, and the grouped Results, each group a plain `h3` over a list of Result rows. Below a hairline rule, a collapsed `<details>` "Excluded" audit section lists what was filtered out and why (each item's domain + exclusion detail). This is the product. It favours readable density, grouped and sourced, never a raw dump, and every claim links out to its source.

## 6. Do's and Don'ts

### Do:
- **Do** keep the Newsprint (`#efe8e3`) `<body>` background and Ink (`#292a2a`) type as the foundation; this warm paper is the committed Drumbeat brand, not a default to second-guess.
- **Do** make the primary action Ink Charcoal, not a colored button. Save Press Blue for links, focus, the active filter, and live signals.
- **Do** keep Press Blue to ≤10% of any screen (The One Accent Rule).
- **Do** attach a source (Mono domain + date) to every Result; trust comes from traceability, not tone, and show "date unknown" rather than hiding a missing date.
- **Do** build depth from tonal layering + `1px border-hair`; ship surfaces flat (`box-shadow: none`) and reserve shadows for true overlays only.
- **Do** carry all type hierarchy with FK Grotesk weight + the fixed rem scale; use Mono only for machine data.
- **Do** keep motion functional and brief: the gauge reveal is `0.3s ease-out`, the running chip a slow opacity pulse, both with a `prefers-reduced-motion` instant fallback.
- **Do** pair every status colour (green / coral / gold) with a glyph, label, or count, never colour alone, and give live regions `role="status"` / `aria-live`.

### Don't:
- **Don't** ship the **generic SaaS template**: no purple gradient, no hero-metric block (big number / small label / supporting stats), no endless identical icon-heading-text card grids. The count triad stays three plain numbers.
- **Don't** drift toward the **cluttered enterprise dashboard**: no dense gray everything-at-once legacy UI. Density must stay grouped and readable.
- **Don't** add **heavy marketing flourish**: no scroll-jacking, oversized hero imagery, or decorative animation that delays the work.
- **Don't** flatten the warm newsprint to a cool gray, or introduce a second warm-neutral family.
- **Don't** use a `border-left`/`border-right` colored stripe (>1px) as an accent on cards, rows, or banners; warnings use a full Coral Surface fill, not a stripe.
- **Don't** use a clamp/fluid heading scale in the app; this is a product surface on a fixed rem scale.
- **Don't** use gradient text (`background-clip: text`), glassmorphism as default decoration, or a tracked all-caps eyebrow above every section.
- **Don't** nest cards, or let muted metadata text drop below 4.5:1 contrast on its background.
