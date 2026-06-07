# Product

## Register

product

## Users

In-house PR and communications professionals. They open Breakbeat to get a fast, current read on a company's public footprint, their own, a competitor's, a partner's, or a target. They're at a desk, often mid-task (prepping a briefing, scanning for fresh coverage, sizing up a reputation), and they value getting the picture quickly over exploring at leisure. They are not engineers; the tool should feel obvious without a manual.

## Product Purpose

Breakbeat is a **third-party content tracker**. A user submits a company name and its homepage URL (the URL disambiguates which company is meant); Breakbeat runs an asynchronous **search job** that finds web content *about* that company and classifies each item by type, news, trade publications, press releases, podcasts, blog posts, newsletters, social posts, and other, while flagging and excluding noise (the company's own channels, aggregators, ecommerce/review pages, duplicates) and surfacing any warnings. It replaces the manual grind of running scattered searches, opening dozens of tabs, and sorting coverage by hand.

The product is organized around **jobs**: each search is a job with a status (`done`, `done_with_warnings`, running, failed), a result count, and a search window. A user can run new searches and revisit recent jobs.

Success looks like: a user names a company, and gets back a classified, sourced, scannable readout of who is talking about it across the web, enough to act on without opening twenty tabs.

## Brand Personality

Modern and approachable. Clean, friendly, and low-intimidation while still feeling credible and professional, the Notion / Vercel register rather than the heavyweight-enterprise one. Voice is plain and helpful, confident without jargon or hype. The interface should reassure an occasional or non-technical user that they're in the right place and reward a regular user with speed.

Three words: clear, fast, trustworthy.

## Anti-references

- **Generic SaaS template.** No purple-gradient hero, no hero-metric template (big number / small label / supporting stats), no endless identical icon-heading-text card grids. The default AI/SaaS look is the thing to avoid.
- **Cluttered enterprise dashboard.** No dense, gray, everything-at-once legacy UI (old Salesforce / SharePoint). Density must stay readable and purposeful.
- **Heavy, slow, marketing-flourish chrome.** No scroll-jacking, oversized imagery, or decorative animation that delays the actual work. Motion is functional, not theatrical.

## Design Principles

1. **Results first.** The aggregated answer is the product. Everything else (search field, filters, chrome) defers to getting the user to readable results fast.
2. **Every claim is traceable.** Aggregated information always carries its source. Trust comes from being able to click through, not from a confident tone.
3. **Approachable density.** Show a lot without overwhelming. Synthesize and group rather than dumping raw lists; an occasional user should never feel lost in a power tool.
4. **Get out of the way.** No decoration that costs the user time. Speed and clarity beat flourish on every screen.
5. **Obvious without a manual.** A non-technical PR pro should understand what to do on first open. Affordances are plain; labels say what will happen.

## Accessibility & Inclusion

Target WCAG 2.1 AA: body text ≥4.5:1 contrast, large text ≥3:1, visible keyboard focus, full keyboard operability for a tool people use repeatedly. Respect `prefers-reduced-motion` (functional crossfade/instant alternatives for any motion). Never use color as the sole carrier of meaning (sentiment, status, source type also get a label, icon, or shape). _(Default assumption, adjust if you have specific WCAG-AAA or other requirements.)_
