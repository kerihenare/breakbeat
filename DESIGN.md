<!-- Derived from the live Drumbeat platform design system (app.drumbeathq.com), sampled 2026-06-07. Breakbeat inherits the Drumbeat brand. Re-run /impeccable document once Breakbeat has its own code to reconcile against the real tokens it ships. -->
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
  border: "#ebe0d8"
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
    fontSize: "clamp(2rem, 4vw, 3rem)"
    fontWeight: 600
    lineHeight: 1.05
    letterSpacing: "-0.02em"
  title:
    fontFamily: "FK Grotesk, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.2
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
  2xl: "16px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
  2xl: "48px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.page-white}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    padding: "10px 16px"
  button-primary-hover:
    backgroundColor: "{colors.ink-soft}"
    textColor: "{colors.page-white}"
  button-secondary:
    backgroundColor: "{colors.newsprint-muted}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    padding: "10px 16px"
  button-secondary-hover:
    backgroundColor: "{colors.newsprint-subtle}"
    textColor: "{colors.ink}"
  input-search:
    backgroundColor: "{colors.page-white}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: "10px 14px"
  card:
    backgroundColor: "{colors.card-cream}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
    padding: "20px"
---

# Design System: Breakbeat

## 1. Overview

**Creative North Star: "The Clipping Desk"**

Breakbeat is where a PR pro sits down, names a company, and watches its public footprint assemble itself, the modern descendant of the press-clipping desk where comms teams once pinned coverage to a board. The system inherits the Drumbeat platform's identity wholesale: warm **newsprint** paper, **ink charcoal** type, and a single press-room sans (FK Grotesk). The aesthetic is editorial and calm, not the cold blue-gray of generic SaaS. The paper is warm on purpose; it reads like a desk, not a dashboard.

This is a **product** surface, design serves the task. The aggregated results are the loudest thing on any screen; everything else (the search field, filters, chrome) is quiet ink-on-paper that gets out of the way. Color is **restrained**: the warm neutral ramp carries the surface, ink charcoal carries text and the one primary action, and a single **press blue** accent marks links, focus, and live notifications, kept to a small fraction of any screen. Brand secondaries (green for live/found, coral for alerts, gold for flags) appear only as semantic signals, never decoration.

It explicitly rejects three things, carried verbatim from PRODUCT.md: the **generic SaaS template** (no purple gradient, no hero-metric block, no endless identical icon-card grids); the **cluttered enterprise dashboard** (no dense gray everything-at-once legacy UI); and **heavy marketing flourish** (no scroll-jacking, oversized imagery, or decorative animation that delays the work).

**Key Characteristics:**
- Warm newsprint paper foundation with ink-charcoal type, editorial not corporate.
- One press-blue accent, used sparingly for action, focus, and live signals.
- A single humanist sans (FK Grotesk) carrying all hierarchy through weight and scale.
- Flat surfaces, hairline borders, fast functional motion (no choreography).
- Results-first: the aggregated answer dominates; chrome recedes.

## 2. Colors

A warm newsprint neutral ramp anchored by ink charcoal, with a single press-blue accent and a small set of semantic brand signals.

### Primary
- **Ink Charcoal** (`#292a2a`): The workhorse. Body text, headings, icons, and the single primary button fill. This is the "ink" the whole system is printed in.
- **Soft Ink** (`#3f3e3e`): Primary button hover, slightly lifted ink for interactive states.
- **Deep Ink** (`#0f1010`): Reserved for the highest-emphasis text (a company name as the page subject, a key figure).
- **Press Blue** (`#1a8cd6`): The one accent. Links, selected states, live-notification accents, and the loudest call to action when ink alone won't carry it. Used on ≤10% of any screen.
- **Deep Press Blue** (`#1071b3`): Press-blue on hover/active, and notification accent text where contrast against light surfaces matters.
- **Focus Blue** (`#46bbff`): Focus rings only. The brighter blue reads clearly as a keyboard-focus signal against both paper and white.

### Secondary (semantic signals, never decoration)
- **Live Green** (`#25b566`) on **Live Surface** (`#bbf5d7`): "found / current / live" status, fresh coverage, active monitoring.
- **Alert Coral** (`#e85a68`) on **Coral Surface** (`#fec2c8`): warnings, negative-sentiment flags, errors. (Paired with an icon or label, never color alone.)
- **Aether Gold** (`#f0be0a`): rare highlight, a pinned or flagged item, a single emphasized data point.

### Neutral (the newsprint ramp)
- **Page White** (`#fdfdfc`): The cleanest base, used behind the densest reading (a full results column).
- **Newsprint** (`#efe8e3`): The signature body background. Warm paper that gives the product its desk-not-dashboard character.
- **Newsprint Muted** (`#f7f3ef`) / **Newsprint Subtle** (`#f3ece7`): Tonal layering for secondary surfaces, secondary buttons, hovered rows.
- **Card Cream** (`#fcfaf9`): Card and elevated-surface fill, a hair lighter than the paper so cards read as lifted without a shadow.
- **Border** (`#ebe0d8`) / **Border Muted** (`#d8cbc0`): Hairline dividers and container edges. Depth comes from these, not from shadow.
- **Text Muted** (`#5c5959`) / **Text Dimmed** (`#6f6b6b`): Secondary and metadata text (dates, source names, counts). Both clear ≥4.5:1 on paper and white.

### Named Rules
**The One Accent Rule.** Press blue is the only chromatic accent in the core UI; it lives on ≤10% of any screen. Its scarcity is what makes "this is actionable / this is live" legible. Semantic green, coral, and gold are signals, not accents, they appear only when they carry meaning.

**The Warm-On-Purpose Rule.** The newsprint background is a committed brand choice, not the AI warm-cream reflex. Never flatten it to a cool gray "to be safe," and never add a second warm-neutral family. The warmth is the brand; the variation is tonal (lighter/darker newsprint), not hue-shifted.

## 3. Typography

**Display Font:** FK Grotesk (with `system-ui` / `-apple-system` fallback)
**Body Font:** FK Grotesk (same family, lighter weights)
**Label/Mono Font:** `ui-monospace` system stack (for source URLs, timestamps, counts)

**Character:** One humanist grotesque carries the entire system. Hierarchy comes from weight and scale, not from a second typeface, which keeps a data-dense PR readout calm and fast to scan. FK Grotesk reads cleanly at small sizes (essential at metadata density) and holds presence at display sizes for a company name.

### Hierarchy
- **Display** (600, `clamp(2rem, 4vw, 3rem)`, line-height 1.05, `-0.02em`): The page subject, typically the searched company name. One per view.
- **Title** (600, `1.5rem`, line-height 1.2, `-0.01em`): Section headings within a result (Coverage, Mentions, Sentiment).
- **Body** (400, `1rem`, line-height 1.5): The default. Aggregated summaries and reading copy. Cap measure at 65–75ch.
- **Label** (500, `0.875rem`): Buttons, field labels, chips, table headers, secondary nav.
- **Mono** (400, `0.8125rem`): Source URLs, ISO dates, mention counts, anything that benefits from tabular alignment and a "data" texture.

### Named Rules
**The One Family Rule.** FK Grotesk does all the work. No second display or body face. Mono appears only on machine data (URLs, timestamps, counts), never on prose.

**The No-Caps-Body Rule.** Uppercase is reserved for short labels (≤4 words) and never used on sentences. No tracked all-caps eyebrows above sections.

## 4. Elevation

The system is **flat by default**. Depth is built from the tonal newsprint ramp and hairline borders, not from shadow: a card is Card Cream (`#fcfaf9`) sitting on Newsprint (`#efe8e3`) with a `1px` Border edge, so it reads as lifted without any drop shadow. This keeps the surface calm and avoids the heavy, dated look the brand rejects.

Shadows appear only on genuinely floating layers, overlays that escape the document flow (dropdowns, popovers, modals, toasts). They are soft and diffuse, never the dark, tight shadow of a 2014 app.

### Shadow Vocabulary
- **Overlay** (`box-shadow: 0 8px 24px rgba(41, 42, 42, 0.12)`): Dropdowns, popovers, command menus. Soft, warm-tinted, ambient.
- **Modal** (`box-shadow: 0 16px 48px rgba(41, 42, 42, 0.18)`): Dialogs and full overlays that need to sit clearly above a dimmed backdrop.

### Named Rules
**The Flat-By-Default Rule.** Surfaces are flat at rest. A shadow means "this floats above the page." If an element isn't a true overlay, it gets a border and a tonal shift, not a shadow.

## 5. Components

### Buttons
- **Shape:** Gently rounded (8px radius, `{rounded.lg}`).
- **Primary:** Ink Charcoal fill (`#292a2a`), Page White text, `10px 16px` padding, Label type (500, 0.875rem). The primary action is ink, not a colored button, color is reserved for the accent.
- **Hover / Focus:** Background lifts to Soft Ink (`#3f3e3e`) over `0.15s`. Focus shows a Focus Blue (`#46bbff`) ring, never a removed outline.
- **Secondary:** Newsprint Muted fill (`#f7f3ef`), Ink text, same shape and padding; hover to Newsprint Subtle (`#f3ece7`).
- **Tertiary / Ghost:** Transparent fill, Ink text; hover gets a Newsprint Subtle wash. Used for low-emphasis actions inside dense result lists.

### Inputs / Fields
- **Style:** Page White fill, `1px` Border Muted (`#d8cbc0`) stroke, 8px radius, `10px 14px` padding, Body type.
- **Focus:** Border shifts to Focus Blue (`#46bbff`) with a matching soft ring; no glow theatrics.
- **The search field** is the signature input, it's the front door to the whole product and earns slightly more size and presence than a standard field.
- **Error:** Border and helper text shift to Alert Coral (`#e85a68`), always paired with a text message, never color alone.

### Cards / Containers
- **Corner Style:** 12px radius (`{rounded.xl}`) for result cards; 8px for compact list items.
- **Background:** Card Cream (`#fcfaf9`) on the Newsprint page.
- **Shadow Strategy:** None at rest (see Elevation). Lift is tonal + bordered.
- **Border:** `1px` Border (`#ebe0d8`).
- **Internal Padding:** `20px` (`{spacing.lg}`-ish), tightening to `12–16px` in dense lists.
- **Never nest cards.** A card inside a card is always wrong; use spacing, dividers, or tonal sections instead.

### Chips / Tags
- **Style:** Newsprint Subtle background, Ink or Text Muted label, fully rounded or 6px radius, Label type. Used for source types, sentiment tags, and filters.
- **State:** Selected filter chips take a Press Blue text + border treatment (or Live Green for status), unselected stay neutral.

### Navigation
- **Style:** Quiet ink-on-paper. Label type (500, 0.875rem), Text Muted at rest, Ink on hover/active.
- **Active state:** Ink text with a Press Blue underline or marker, color marks the current place sparingly.
- **Mobile:** Collapses to a single clear menu; the search field stays reachable.

### Signature Component: The Result Aggregation
The core surface is the assembled company readout, a single scrollable column (or two-column on wide screens) that synthesizes coverage, mentions, and signals into grouped, scannable sections, each item carrying its source inline (mono URL + date). This is the product. It favors readable density: grouped and summarized, never a raw dump, and every claim links out to its source.

## 6. Do's and Don'ts

### Do:
- **Do** keep the Newsprint (`#efe8e3`) background and Ink (`#292a2a`) type as the foundation; this warm paper is the committed Drumbeat brand, not a default to second-guess.
- **Do** make the primary action Ink Charcoal, not a colored button. Save Press Blue for links, focus, live signals, and the rare loudest CTA.
- **Do** keep Press Blue to ≤10% of any screen (The One Accent Rule).
- **Do** attach a source (mono URL + date) to every aggregated claim; trust comes from traceability, not tone.
- **Do** build depth from tonal layering + `1px` borders; reserve shadows for true overlays only.
- **Do** carry all type hierarchy with FK Grotesk weight + scale; use mono only for machine data.
- **Do** keep motion functional: `0.15s` state transitions, ease-out entrances for results, with a `prefers-reduced-motion` crossfade/instant fallback.
- **Do** pair every status color (green/coral/gold) with an icon or label, never color alone.

### Don't:
- **Don't** ship the **generic SaaS template**: no purple gradient, no hero-metric block (big number / small label / supporting stats), no endless identical icon-heading-text card grids.
- **Don't** drift toward the **cluttered enterprise dashboard**: no dense gray everything-at-once legacy UI. Density must stay grouped and readable.
- **Don't** add **heavy marketing flourish**: no scroll-jacking, oversized hero imagery, or decorative animation that delays the work.
- **Don't** flatten the warm newsprint to a cool gray, or introduce a second warm-neutral family.
- **Don't** use a `border-left`/`border-right` colored stripe (>1px) as an accent on cards, rows, or alerts.
- **Don't** use gradient text (`background-clip: text`), glassmorphism as default decoration, or a tracked all-caps eyebrow above every section.
- **Don't** nest cards, or let muted metadata text drop below 4.5:1 contrast on its background.
