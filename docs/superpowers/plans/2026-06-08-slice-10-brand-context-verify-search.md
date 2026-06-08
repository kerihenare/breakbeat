# Slice 10 — Brand Context, Verify stage & Anthropic search backstop — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrich Resolve with the BrandFetch Brand API + Brand Context API, add an Anthropic web-search backstop in parallel with Tavily, and promote entity verification into its own Verify stage that runs before Classify.

**Architecture:** New `verifying` pipeline stage between Filter and Classify, anchored on a Brand Context stored on the Resolved Identity. A `ResultVerifier` port (Claude Haiku) judges title+snippet+URL: confident entity-misses are Excluded with a new `off_topic` code; softer ones are flagged `uncertain` and stay included. Search gains a separate `WebSearchBackstop` port (Anthropic `web_search` tool) that runs a few broad NL queries in parallel with Tavily and escalates to the full angle set when Tavily is thin. The Clipping Desk surfaces the `uncertain` marker and the `off_topic` reason.

**Tech Stack:** NestJS (compiled TS, decorators + constructor param properties), Drizzle/postgres.js, BullMQ/Redis, `@anthropic-ai/sdk`, `@tavily/core`, Nunjucks, Jest, Biome, pnpm.

**Spec:** `docs/superpowers/specs/2026-06-08-slice-10-brand-context-verify-search.md`

**Conventions observed in this codebase (match them):**
- Ports are `Symbol` tokens + an `interface`, injected with `@Inject(TOKEN)`. Constructor parameter properties are idiomatic (NestJS DI — *not* a CodeRabbit violation here).
- DB text columns are validated against closed sets via `parseEnum`/`parseEnumOrNull` before entering the domain (no `as`).
- Stage failures that still leave a reviewable list are **Warnings**, never Job failures.
- Object literals/properties are alphabetically ordered (Biome `useSortedKeys` is clearly applied). Keep keys sorted.
- Run a single test file with: `pnpm jest <path>` (or `pnpm test` for all). Lint with `pnpm lint:fix`.

**Commit policy:** This repo's profile is **conservative** — do **not** push or open PRs unless the user asks. Local commits per task are expected by this plan (frequent commits); if the user prefers no commits at all, batch into the final handoff instead.

---

## File map

**Domain (create):**
- `src/modules/jobs/domain/ports/result-verifier.port.ts` — Verify port + verdict types
- `src/modules/jobs/domain/ports/web-search-backstop.port.ts` — backstop search port
- `src/modules/jobs/domain/services/verify-prompt.ts` — Haiku verify prompt + schema
- `src/modules/jobs/domain/brand-context.ts` — `BrandContext` type

**Domain (modify):**
- `src/modules/jobs/domain/exclusion.ts` — add `off_topic`
- `src/modules/jobs/domain/job-status.ts` — add `verifying` + edges
- `src/modules/jobs/domain/result.ts` — `verificationStatus` field + setter
- `src/modules/jobs/domain/resolved-identity.ts` — optional `context`
- `src/modules/jobs/domain/services/search-queries.ts` — NL backstop queries + threshold
- `src/modules/jobs/domain/services/classify-prompt.ts` — generalize `validateResultIds`; feed Brand Context

**Application (create):**
- `src/modules/jobs/application/verify-stage.ts` (+ `.spec.ts`)

**Application (modify):**
- `src/modules/jobs/application/search-stage.ts` (+ `.spec.ts`)
- `src/modules/jobs/application/resolve-stage.ts` (+ `.spec.ts`)
- `src/modules/jobs/application/pipeline.service.ts`

**Infrastructure (create):**
- `src/modules/jobs/infrastructure/anthropic/haiku-verifier.ts`
- `src/modules/jobs/infrastructure/anthropic/anthropic-web-search.ts`

**Infrastructure (modify):**
- `src/modules/jobs/infrastructure/brandfetch/brandfetch-client.ts` (+ `.spec.ts`)
- `src/modules/jobs/infrastructure/persistence/result.repository.ts`
- `src/modules/jobs/infrastructure/persistence/job.repository.ts`
- `src/modules/jobs/domain/ports/brand-directory.port.ts`
- `src/modules/jobs/domain/ports/result-repository.port.ts`

**Persistence:**
- `src/shared/database/schema.ts` — two new columns + Drizzle migration

**Interface / UI:**
- `src/modules/jobs/interface/view-model.ts` (+ `.spec.ts`)
- `src/modules/jobs/interface/demo-fixtures.ts`
- `views/_result_row.njk`

**Wiring:**
- `src/modules/jobs/jobs.module.ts`

**Docs:**
- `CONTEXT.md`, `.env.example`, `docs/aglow-writeup.md`

---

## Task 1: Add the `off_topic` exclusion code

**Files:**
- Modify: `src/modules/jobs/domain/exclusion.ts`
- Test: `src/modules/jobs/domain/exclusion.spec.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
// src/modules/jobs/domain/exclusion.spec.ts
import { EXCLUSION_CODES } from "./exclusion";

describe("exclusion codes", () => {
	it("includes off_topic (entity-mismatch) in the closed set", () => {
		expect(EXCLUSION_CODES).toContain("off_topic");
	});
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `pnpm jest src/modules/jobs/domain/exclusion.spec.ts`
Expected: FAIL — `off_topic` not in the array.

- [ ] **Step 3: Add the code**

In `exclusion.ts`, add `| "off_topic"` to the `ExclusionCode` union and `"off_topic"` to the `EXCLUSION_CODES` array (keep alphabetical-ish ordering consistent with the file — append after `"out_of_window"` to match the union order):

```ts
export type ExclusionCode =
	| "own_channel"
	| "aggregator"
	| "ecommerce_review"
	| "out_of_window"
	| "duplicate"
	| "off_topic";

export const EXCLUSION_CODES: readonly ExclusionCode[] = [
	"own_channel",
	"aggregator",
	"ecommerce_review",
	"out_of_window",
	"duplicate",
	"off_topic",
];
```

- [ ] **Step 4: Run it — expect PASS**

Run: `pnpm jest src/modules/jobs/domain/exclusion.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/jobs/domain/exclusion.ts src/modules/jobs/domain/exclusion.spec.ts
git commit -m "feat(domain): add off_topic exclusion code"
```

---

## Task 2: Add the `verifying` Job status and its edges

**Files:**
- Modify: `src/modules/jobs/domain/job-status.ts`
- Test: `src/modules/jobs/domain/job-status.spec.ts` (create — confirm none exists first with `ls`)

- [ ] **Step 1: Write the failing test**

```ts
// src/modules/jobs/domain/job-status.spec.ts
import { canTransition, JOB_STATUSES } from "./job-status";

describe("verifying status", () => {
	it("is a known status", () => {
		expect(JOB_STATUSES).toContain("verifying");
	});
	it("sits between filtering and classifying", () => {
		expect(canTransition("filtering", "verifying")).toBe(true);
		expect(canTransition("verifying", "classifying")).toBe(true);
		expect(canTransition("filtering", "classifying")).toBe(false);
	});
	it("can short-circuit to a terminal", () => {
		expect(canTransition("verifying", "done_with_warnings")).toBe(true);
		expect(canTransition("verifying", "failed")).toBe(true);
	});
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `pnpm jest src/modules/jobs/domain/job-status.spec.ts`
Expected: FAIL — `verifying` unknown; `filtering → classifying` still legal.

- [ ] **Step 3: Edit `job-status.ts`**

Add `"verifying"` to the `JobStatus` union and the `JOB_STATUSES` array (insert after `"filtering"`). Then change the `filtering` edge to point at `verifying`, and add a `verifying` edge:

```ts
["filtering", new Set<JobStatus>(["verifying", "failed"])],
["verifying", new Set<JobStatus>(["classifying", "done", "done_with_warnings", "failed"])],
```

Leave the `classifying`/`extracting`/`refining` edges unchanged.

- [ ] **Step 4: Run it — expect PASS**

Run: `pnpm jest src/modules/jobs/domain/job-status.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/jobs/domain/job-status.ts src/modules/jobs/domain/job-status.spec.ts
git commit -m "feat(domain): insert verifying status between filtering and classifying"
```

---

## Task 3: `verificationStatus` on the Result aggregate

**Files:**
- Modify: `src/modules/jobs/domain/result.ts`
- Test: `src/modules/jobs/domain/result.spec.ts` (create — confirm none exists)

- [ ] **Step 1: Write the failing test**

```ts
// src/modules/jobs/domain/result.spec.ts
import { Result } from "./result";

function r(): Result {
	return new Result("id", "job", "https://x/y", "x/y", "T", "x", null);
}

describe("Result verification status", () => {
	it("is born null", () => {
		expect(r().verificationStatus).toBeNull();
	});
	it("records a verification status", () => {
		const result = r();
		result.setVerification("uncertain");
		expect(result.verificationStatus).toBe("uncertain");
	});
	it("hydrates from state", () => {
		const result = new Result(
			"id", "job", "https://x/y", "x/y", "T", "x", null, null, null,
			{ verificationStatus: "verified" },
		);
		expect(result.verificationStatus).toBe("verified");
	});
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `pnpm jest src/modules/jobs/domain/result.spec.ts`
Expected: FAIL — `verificationStatus`/`setVerification` undefined.

- [ ] **Step 3: Edit `result.ts`**

Add the type and field. Near the top exports:

```ts
export type VerificationStatus = "verified" | "uncertain";

export const VERIFICATION_STATUSES: readonly VerificationStatus[] = [
	"verified",
	"uncertain",
];
```

Add `verificationStatus?: VerificationStatus | null;` to `ResultState`. Add the field declaration `verificationStatus: VerificationStatus | null;` to the class, initialise it in the constructor body alongside the others:

```ts
this.verificationStatus = state.verificationStatus ?? null;
```

Add the setter (after `classify`):

```ts
/** Record the Verify stage's entity-relevance judgement. */
setVerification(status: VerificationStatus): void {
	this.verificationStatus = status;
}
```

- [ ] **Step 4: Run it — expect PASS**

Run: `pnpm jest src/modules/jobs/domain/result.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/jobs/domain/result.ts src/modules/jobs/domain/result.spec.ts
git commit -m "feat(domain): add verificationStatus to Result"
```

---

## Task 4: `BrandContext` type + optional `context` on Resolved Identity

**Files:**
- Create: `src/modules/jobs/domain/brand-context.ts`
- Modify: `src/modules/jobs/domain/resolved-identity.ts`
- Test: `src/modules/jobs/domain/brand-context.spec.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
// src/modules/jobs/domain/brand-context.spec.ts
import { brandContextToText } from "./brand-context";

describe("brandContextToText", () => {
	it("renders description + industry + aliases as prompt-ready lines", () => {
		const text = brandContextToText({
			aliases: ["Acme Inc", "Acme Corp"],
			description: "A developer tools company.",
			industry: "Software",
		});
		expect(text).toContain("A developer tools company.");
		expect(text).toContain("Software");
		expect(text).toContain("Acme Inc");
	});
	it("omits empty fields cleanly", () => {
		const text = brandContextToText({
			aliases: [],
			description: "Just a description.",
			industry: null,
		});
		expect(text).toBe("Just a description.");
	});
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `pnpm jest src/modules/jobs/domain/brand-context.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `brand-context.ts`**

```ts
// src/modules/jobs/domain/brand-context.ts

/**
 * A compact, prompt-ready description of what a company actually is — sourced
 * from the BrandFetch Brand Context API (or composed from the Brand API company
 * fields + Google context as a fallback). Stored on the Resolved Identity and
 * consumed by the Verify and Classify stages to anchor entity disambiguation.
 */
export type BrandContext = {
	description: string;
	industry: string | null;
	aliases: string[];
};

/** Render a BrandContext as compact lines for an LLM prompt; omits empty parts. */
export function brandContextToText(context: BrandContext): string {
	const lines = [context.description.trim()];
	if (context.industry) lines.push(`Industry: ${context.industry}`);
	if (context.aliases.length > 0) {
		lines.push(`Also known as: ${context.aliases.join(", ")}`);
	}
	return lines.join("\n");
}
```

- [ ] **Step 4: Add `context` to `ResolvedIdentity`**

In `resolved-identity.ts`, import the type and add an optional field (optional keeps existing call sites compiling):

```ts
import type { BrandContext } from "./brand-context";
// ...inside the ResolvedIdentity type, after negativeMatches:
	readonly context?: BrandContext | null;
```

- [ ] **Step 5: Run it — expect PASS**

Run: `pnpm jest src/modules/jobs/domain/brand-context.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/modules/jobs/domain/brand-context.ts src/modules/jobs/domain/brand-context.spec.ts src/modules/jobs/domain/resolved-identity.ts
git commit -m "feat(domain): add BrandContext type and optional context on Resolved Identity"
```

---

## Task 5: Migration — `results.verification_status` + `jobs.brand_context`

**Files:**
- Modify: `src/shared/database/schema.ts`
- Create: a generated migration under `src/shared/database/migrations/` (via `pnpm db:generate`)

- [ ] **Step 1: Edit `schema.ts`**

In the `results` table, add (keep keys sorted — place after `url`/before the closing, alphabetically `verificationStatus` sorts after `url`):

```ts
verificationStatus: text("verification_status"),
```

In the `jobs` table, import `jsonb` is already imported. Add (alphabetical — `brandContext` sorts after `id`? keep file's existing ordering; place near `contextNote`):

```ts
brandContext: jsonb("brand_context").$type<BrandContext>(),
```

Add the import at the top of `schema.ts`:

```ts
import type { BrandContext } from "../../modules/jobs/domain/brand-context";
```

- [ ] **Step 2: Generate the migration**

Run: `pnpm db:generate`
Expected: a new SQL file appears (e.g. `0004_*.sql`) containing roughly:

```sql
ALTER TABLE "results" ADD COLUMN "verification_status" text;
ALTER TABLE "jobs" ADD COLUMN "brand_context" jsonb;
```

Confirm the generated SQL matches that intent (two `ADD COLUMN`s, both nullable, no data loss). If `db:generate` prompts interactively, choose "create column" (not rename).

- [ ] **Step 3: Apply it**

Run: `docker compose up -d postgres && pnpm db:migrate`
Expected: migration applies cleanly. Verify with `pnpm db:reset` afterwards is **not** needed.

- [ ] **Step 4: Commit**

```bash
git add src/shared/database/schema.ts src/shared/database/migrations/
git commit -m "feat(db): add verification_status and brand_context columns"
```

---

## Task 6: Persistence mapping for the two new columns

**Files:**
- Modify: `src/modules/jobs/domain/ports/result-repository.port.ts`
- Modify: `src/modules/jobs/infrastructure/persistence/result.repository.ts`
- Modify: `src/modules/jobs/infrastructure/persistence/job.repository.ts`
- Test: `src/modules/jobs/infrastructure/persistence/result.repository.spec.ts` (create — pure mapper test, no live DB)

The repository talks to a live DB, so test only the **pure** mapping helper. Extract `toDomain` is already module-private; expose a thin pure function to test verification mapping.

- [ ] **Step 1: Add `setVerification` to the port**

In `result-repository.port.ts`, import `VerificationStatus` and add to the interface:

```ts
import type { VerificationStatus } from "../result";
// ...in ResultRepository:
	setVerification(id: string, status: VerificationStatus): Promise<void>;
```

- [ ] **Step 2: Write the failing mapper test**

```ts
// src/modules/jobs/infrastructure/persistence/result.repository.spec.ts
import { rowToResult } from "./result.repository";

const baseRow = {
	confidence: null,
	contentType: null,
	createdAt: new Date(),
	exclusionCode: null,
	exclusionDetail: null,
	id: "11111111-1111-1111-1111-111111111111",
	jobId: "22222222-2222-2222-2222-222222222222",
	normalizedUrl: "x/y",
	publishedDate: null,
	score: null,
	sentiment: null,
	snippet: null,
	sourceDomain: "x",
	status: "included",
	title: "T",
	url: "https://x/y",
	verificationStatus: "uncertain",
};

describe("rowToResult verification mapping", () => {
	it("maps verification_status onto the domain", () => {
		expect(rowToResult(baseRow).verificationStatus).toBe("uncertain");
	});
	it("maps null verification_status to null", () => {
		expect(rowToResult({ ...baseRow, verificationStatus: null }).verificationStatus).toBeNull();
	});
});
```

- [ ] **Step 3: Run it — expect FAIL**

Run: `pnpm jest src/modules/jobs/infrastructure/persistence/result.repository.spec.ts`
Expected: FAIL — `rowToResult` not exported.

- [ ] **Step 4: Edit `result.repository.ts`**

Rename `toDomain` → export it as `rowToResult` (update the two `.map(toDomain)` call sites). Import the status set and map the column:

```ts
import { RESULT_STATUSES, Result, SENTIMENTS, VERIFICATION_STATUSES } from "../../domain/result";
```

Inside the state object passed to `new Result(...)`, add:

```ts
verificationStatus: parseEnumOrNull(
	row.verificationStatus,
	VERIFICATION_STATUSES,
	"verification status",
),
```

In `insertIfNew`'s `.values({...})`, add `verificationStatus: result.verificationStatus,` (keys sorted — after `url`). Add the new method:

```ts
async setVerification(id: string, status: VerificationStatus): Promise<void> {
	await this.db
		.update(results)
		.set({ verificationStatus: status })
		.where(eq(results.id, id));
}
```

Import `VerificationStatus` type:

```ts
import { RESULT_STATUSES, Result, SENTIMENTS, VERIFICATION_STATUSES, type VerificationStatus } from "../../domain/result";
```

- [ ] **Step 5: Map `brand_context` in `job.repository.ts`**

In `save`, add to the `row` object and the `onConflictDoUpdate.set`:

```ts
brandContext: job.resolvedIdentity?.context ?? null,
```

In `findById`, add `context` to the reconstructed `resolvedIdentity` (only when present):

```ts
context: row.brandContext ?? null,
```

(Place it inside the `resolvedDomains !== null ? {...}` identity object, keys sorted — `context` first.)

- [ ] **Step 6: Run it — expect PASS; build the project**

Run: `pnpm jest src/modules/jobs/infrastructure/persistence/result.repository.spec.ts`
Expected: PASS.
Run: `pnpm build` (or `pnpm tsc --noEmit` if available) — confirm no type errors from the port change.

- [ ] **Step 7: Commit**

```bash
git add src/modules/jobs/domain/ports/result-repository.port.ts src/modules/jobs/infrastructure/persistence/
git commit -m "feat(persistence): map verification_status and brand_context"
```

---

## Task 7: Verify prompt + generalize id reconciliation + feed context to Classify

**Files:**
- Create: `src/modules/jobs/domain/services/verify-prompt.ts`
- Modify: `src/modules/jobs/domain/services/classify-prompt.ts`
- Test: `src/modules/jobs/domain/services/verify-prompt.spec.ts` (create)

- [ ] **Step 1: Generalize `validateResultIds` (DRY — Verify reuses it)**

In `classify-prompt.ts`, change the signature so it accepts any `{ id: string }[]`:

```ts
export function validateResultIds<T extends { id: string }>(
	sent: Set<string>,
	received: T[],
): { valid: T[]; rogue: string[]; missing: string[] } {
```

(Body is unchanged — it only reads `.id`.)

- [ ] **Step 2: Feed Brand Context into the classify prompt**

In `buildClassifyPrompt`, after the `negativeMatches` block, append a context line when present:

```ts
if (identity.context) {
	identityLines.push(`What this company is: ${brandContextToText(identity.context)}`);
}
```

Add the import at the top of `classify-prompt.ts`:

```ts
import { brandContextToText } from "../brand-context";
```

- [ ] **Step 3: Write the failing verify-prompt test**

```ts
// src/modules/jobs/domain/services/verify-prompt.spec.ts
import type { ResolvedIdentity } from "../resolved-identity";
import { buildVerifyPrompt, VERIFY_RESPONSE_SCHEMA } from "./verify-prompt";

const identity: ResolvedIdentity = {
	context: { aliases: [], description: "A fintech payments company.", industry: "Fintech" },
	domains: ["acme.com"],
	handles: [],
	name: "Acme",
	negativeMatches: ["acmefoods.com"],
	provenance: "url_provided",
	window: { end: "2026-06-08", start: "2023-06-08" },
};

describe("buildVerifyPrompt", () => {
	it("states the brand context and the disambiguation question", () => {
		const prompt = buildVerifyPrompt(
			[{ id: "a", snippet: "Acme launches new card", sourceDomain: "n", title: "T", url: "https://n/a" }],
			identity,
		);
		expect(prompt).toContain("A fintech payments company.");
		expect(prompt).toContain("acmefoods.com");
		expect(prompt).toContain("id: a");
	});
	it("exposes a closed-enum schema (match/mismatch/uncertain, high/low)", () => {
		const decision = VERIFY_RESPONSE_SCHEMA.properties.results.items.properties.decision.enum;
		expect(decision).toEqual(["match", "mismatch", "uncertain"]);
	});
});
```

- [ ] **Step 4: Run it — expect FAIL**

Run: `pnpm jest src/modules/jobs/domain/services/verify-prompt.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 5: Create `verify-prompt.ts`**

```ts
// src/modules/jobs/domain/services/verify-prompt.ts
import { brandContextToText } from "../brand-context";
import type { ResolvedIdentity } from "../resolved-identity";

export const VERIFY_MODEL = "claude-haiku-4-5";
export const VERIFY_CAP = 400;
export const VERIFY_CHUNK_SIZE = 50;

export type VerifyDecisionRaw = "match" | "mismatch" | "uncertain";

export type VerifyInput = {
	id: string;
	title: string;
	url: string;
	sourceDomain: string;
	snippet: string | null;
};

// Closed-enum JSON schema for Anthropic structured outputs. No free-text field
// (the prompt-injection echo channel). `id` is echoed back for reconciliation.
export const VERIFY_RESPONSE_SCHEMA = {
	additionalProperties: false,
	properties: {
		results: {
			items: {
				additionalProperties: false,
				properties: {
					confidence: { enum: ["high", "low"], type: "string" },
					decision: { enum: ["match", "mismatch", "uncertain"], type: "string" },
					id: { type: "string" },
				},
				required: ["id", "decision", "confidence"],
				type: "object",
			},
			type: "array",
		},
	},
	required: ["results"],
	type: "object",
} as const;

export type VerifyVerdictRaw = {
	id: string;
	decision: VerifyDecisionRaw;
	confidence: "high" | "low";
};

/** Pure: build the user-turn prompt for one verification chunk. */
export function buildVerifyPrompt(
	inputs: VerifyInput[],
	identity: ResolvedIdentity,
): string {
	const identityLines = [`Company name: ${identity.name}`];
	if (identity.domains.length > 0) {
		identityLines.push(`Own domains: ${identity.domains.join(", ")}`);
	}
	if (identity.context) {
		identityLines.push(`What this company is: ${brandContextToText(identity.context)}`);
	}
	if (identity.negativeMatches.length > 0) {
		identityLines.push(
			`Different companies with similar names (NOT the target): ${identity.negativeMatches.join(", ")}`,
		);
	}

	const resultLines = inputs
		.map((r) =>
			[
				"---",
				`id: ${r.id}`,
				`title: ${r.title}`,
				`url: ${r.url}`,
				`source_domain: ${r.sourceDomain}`,
				`snippet: ${r.snippet ? r.snippet.trim().slice(0, 1000) : "(no snippet)"}`,
			].join("\n"),
		)
		.join("\n");

	return `You are verifying whether each search result is genuinely about a specific company, for a media monitoring tool.

COMPANY IDENTITY:
${identityLines.join("\n")}

DECISION RULES — for each result decide whether it is about ${identity.name} (the company described above), NOT a different company that merely shares the name:
- "match": clearly about ${identity.name}.
- "mismatch": clearly about a DIFFERENT entity (e.g. one of the similar-named companies, a person, a generic word). Use confidence "high" only when you are certain.
- "uncertain": you cannot tell from the title/snippet/url.
Judge only from the fields given. Do not assume.

For each result below, return: id (echo it exactly), decision, confidence ("high"/"low").
No reasoning. No additional fields.

RESULTS TO VERIFY:
${resultLines}`;
}
```

- [ ] **Step 6: Run it — expect PASS**

Run: `pnpm jest src/modules/jobs/domain/services/verify-prompt.spec.ts src/modules/jobs/application/classify-stage.spec.ts`
Expected: PASS (classify spec still green after the generalization + context line).

- [ ] **Step 7: Commit**

```bash
git add src/modules/jobs/domain/services/verify-prompt.ts src/modules/jobs/domain/services/verify-prompt.spec.ts src/modules/jobs/domain/services/classify-prompt.ts
git commit -m "feat(domain): verify prompt + generalize id reconciliation + brand context in classify"
```

---

## Task 8: `ResultVerifier` port + `HaikuVerifier` adapter

**Files:**
- Create: `src/modules/jobs/domain/ports/result-verifier.port.ts`
- Create: `src/modules/jobs/infrastructure/anthropic/haiku-verifier.ts`
- Test: `src/modules/jobs/infrastructure/anthropic/haiku-verifier.spec.ts` (create — degraded path only)

> **Anthropic SDK note:** This adapter mirrors `haiku-classifier.ts` exactly (beta structured outputs via `output_config.format`). Before writing it, invoke the **claude-api** skill to confirm the current structured-output call shape and model id `claude-haiku-4-5`.

- [ ] **Step 1: Create the port**

```ts
// src/modules/jobs/domain/ports/result-verifier.port.ts
import type { Confidence } from "../exclusion";
import type { ResolvedIdentity } from "../resolved-identity";
import type { VerifyDecisionRaw, VerifyInput } from "../services/verify-prompt";

export const RESULT_VERIFIER = Symbol("RESULT_VERIFIER");

export type VerifyDecision = VerifyDecisionRaw; // "match" | "mismatch" | "uncertain"

export type VerifyVerdict = {
	id: string;
	decision: VerifyDecision;
	confidence: Confidence;
};

/** Judges whether each Result is about the target company (Claude Haiku). */
export interface ResultVerifier {
	verify(inputs: VerifyInput[], identity: ResolvedIdentity): Promise<VerifyVerdict[]>;
	isConfigured(): boolean;
}
```

- [ ] **Step 2: Write the failing degraded test**

```ts
// src/modules/jobs/infrastructure/anthropic/haiku-verifier.spec.ts
import { AppConfigService } from "../../../../shared/config/app-config.service";
import type { ResolvedIdentity } from "../../domain/resolved-identity";
import { HaikuVerifier } from "./haiku-verifier";

const identity: ResolvedIdentity = {
	domains: [], handles: [], name: "Acme", negativeMatches: [],
	provenance: "none", window: { end: "2026-06-08", start: "2023-06-08" },
};

function config(key: string | undefined): AppConfigService {
	return { get: (k: string) => (k === "ANTHROPIC_API_KEY" ? key : "") } as unknown as AppConfigService;
}

describe("HaikuVerifier", () => {
	it("is unconfigured without a key", () => {
		expect(new HaikuVerifier(config(undefined)).isConfigured()).toBe(false);
	});
	it("returns [] when unconfigured", async () => {
		const out = await new HaikuVerifier(config(undefined)).verify(
			[{ id: "a", snippet: null, sourceDomain: "n", title: "T", url: "https://n/a" }],
			identity,
		);
		expect(out).toEqual([]);
	});
});
```

- [ ] **Step 3: Run it — expect FAIL**

Run: `pnpm jest src/modules/jobs/infrastructure/anthropic/haiku-verifier.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Create `haiku-verifier.ts`**

```ts
// src/modules/jobs/infrastructure/anthropic/haiku-verifier.ts
import Anthropic from "@anthropic-ai/sdk";
import { Injectable } from "@nestjs/common";
import { AppConfigService } from "../../../../shared/config/app-config.service";
import { parseEnum } from "../../../../shared/util/parse-enum";
import { CONFIDENCES } from "../../domain/exclusion";
import type { ResultVerifier, VerifyVerdict } from "../../domain/ports/result-verifier.port";
import type { ResolvedIdentity } from "../../domain/resolved-identity";
import { validateResultIds } from "../../domain/services/classify-prompt";
import {
	buildVerifyPrompt,
	type VerifyInput,
	type VerifyVerdictRaw,
	VERIFY_MODEL,
	VERIFY_RESPONSE_SCHEMA,
} from "../../domain/services/verify-prompt";

const DECISIONS = ["match", "mismatch", "uncertain"] as const;

@Injectable()
export class HaikuVerifier implements ResultVerifier {
	constructor(private readonly config: AppConfigService) {}

	isConfigured(): boolean {
		return Boolean(this.config.get("ANTHROPIC_API_KEY"));
	}

	async verify(
		inputs: VerifyInput[],
		identity: ResolvedIdentity,
	): Promise<VerifyVerdict[]> {
		const apiKey = this.config.get("ANTHROPIC_API_KEY");
		if (!apiKey || inputs.length === 0) return [];
		const client = new Anthropic({ apiKey });

		const response = await client.beta.messages.create({
			max_tokens: 4096,
			messages: [{ content: buildVerifyPrompt(inputs, identity), role: "user" }],
			model: VERIFY_MODEL,
			output_config: { format: { schema: VERIFY_RESPONSE_SCHEMA, type: "json_schema" } },
			system:
				"You are a precise entity-verification classifier. Return only valid JSON matching the requested schema. No markdown fences, no commentary.",
		});

		const textBlock = response.content.find((b) => b.type === "text");
		if (textBlock?.type !== "text") {
			throw new Error("no text block in verifier response");
		}
		const parsed = JSON.parse(textBlock.text) as { results?: VerifyVerdictRaw[] };
		if (!Array.isArray(parsed.results)) {
			throw new Error("verifier response missing results array");
		}

		const sent = new Set(inputs.map((i) => i.id));
		const { valid } = validateResultIds(sent, parsed.results);
		return valid
			.filter((v) => DECISIONS.includes(v.decision))
			.map((v) => ({
				confidence: parseEnum(v.confidence, CONFIDENCES, "confidence"),
				decision: v.decision,
				id: v.id,
			}));
	}
}
```

- [ ] **Step 5: Run it — expect PASS**

Run: `pnpm jest src/modules/jobs/infrastructure/anthropic/haiku-verifier.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/modules/jobs/domain/ports/result-verifier.port.ts src/modules/jobs/infrastructure/anthropic/haiku-verifier.ts src/modules/jobs/infrastructure/anthropic/haiku-verifier.spec.ts
git commit -m "feat: ResultVerifier port + HaikuVerifier adapter"
```

---

## Task 9: `VerifyStage` application stage

**Files:**
- Create: `src/modules/jobs/application/verify-stage.ts`
- Test: `src/modules/jobs/application/verify-stage.spec.ts`

Mirrors `ClassifyStage`'s structure: cap, chunk, `Promise.allSettled`, one write per Result, Warnings on partial/total failure, no-op + Warning when unconfigured or no context.

- [ ] **Step 1: Write the failing test**

```ts
// src/modules/jobs/application/verify-stage.spec.ts
import type { Exclusion } from "../domain/exclusion";
import { Job } from "../domain/job";
import type { ResultRepository } from "../domain/ports/result-repository.port";
import type { ResultVerifier, VerifyVerdict } from "../domain/ports/result-verifier.port";
import { Result } from "../domain/result";
import type { VerificationStatus } from "../domain/result";
import { VerifyStage } from "./verify-stage";

const WINDOW = { end: "2026-06-08", start: "2023-06-08" };

function makeJob(withContext = true): Job {
	return new Job("j1", "Acme", "https://acme.com", WINDOW, new Date(), {
		resolvedIdentity: {
			context: withContext
				? { aliases: [], description: "A dev tools company.", industry: "Software" }
				: null,
			domains: ["acme.com"], handles: [], name: "Acme",
			negativeMatches: [], provenance: "url_provided", window: WINDOW,
		},
	});
}

type Recorded =
	| { kind: "verified"; id: string; status: VerificationStatus }
	| { kind: "excluded"; id: string; ex: Exclusion };

function repoStub(results: Result[]): { repo: ResultRepository; recorded: Recorded[] } {
	const recorded: Recorded[] = [];
	const repo: ResultRepository = {
		findAllByJob: async () => results,
		findIncludedByJob: async () => results.filter((r) => !r.isExcluded),
		insertIfNew: async () => true,
		markClassified: async () => {},
		markExcluded: async (id, ex) => { recorded.push({ ex, id, kind: "excluded" }); },
		setVerification: async (id, status) => { recorded.push({ id, kind: "verified", status }); },
	};
	return { recorded, repo };
}

function result(id: string): Result {
	return new Result(id, "j1", `https://n/${id}`, `n/${id}`, "Title", "n", "2025-01-01", "snippet");
}

function verifier(verdicts: VerifyVerdict[], configured = true): ResultVerifier {
	return { isConfigured: () => configured, verify: async () => verdicts };
}

describe("VerifyStage", () => {
	it("excludes a high-confidence mismatch as off_topic/LLM", async () => {
		const { repo, recorded } = repoStub([result("a")]);
		await new VerifyStage(repo, verifier([
			{ confidence: "high", decision: "mismatch", id: "a" },
		])).run(makeJob());
		expect(recorded).toContainEqual({ ex: { code: "off_topic", detail: "LLM" }, id: "a", kind: "excluded" });
	});

	it("marks a match as verified", async () => {
		const { repo, recorded } = repoStub([result("a")]);
		await new VerifyStage(repo, verifier([
			{ confidence: "high", decision: "match", id: "a" },
		])).run(makeJob());
		expect(recorded).toContainEqual({ id: "a", kind: "verified", status: "verified" });
	});

	it("marks an uncertain verdict (and a low-confidence mismatch) as uncertain — never excluded", async () => {
		const { repo, recorded } = repoStub([result("a"), result("b")]);
		await new VerifyStage(repo, verifier([
			{ confidence: "low", decision: "uncertain", id: "a" },
			{ confidence: "low", decision: "mismatch", id: "b" },
		])).run(makeJob());
		expect(recorded).toContainEqual({ id: "a", kind: "verified", status: "uncertain" });
		expect(recorded).toContainEqual({ id: "b", kind: "verified", status: "uncertain" });
		expect(recorded.some((r) => r.kind === "excluded")).toBe(false);
	});

	it("warns and does nothing when the verifier is unconfigured", async () => {
		const { repo, recorded } = repoStub([result("a")]);
		const job = makeJob();
		await new VerifyStage(repo, verifier([], false)).run(job);
		expect(recorded).toEqual([]);
		expect(job.warnings.some((w) => /not configured/.test(w.message))).toBe(true);
	});

	it("warns and does nothing when there is no brand context", async () => {
		const { repo, recorded } = repoStub([result("a")]);
		const job = makeJob(false);
		await new VerifyStage(repo, verifier([{ confidence: "high", decision: "match", id: "a" }])).run(job);
		expect(recorded).toEqual([]);
		expect(job.warnings.some((w) => /no brand context/.test(w.message))).toBe(true);
	});
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `pnpm jest src/modules/jobs/application/verify-stage.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `verify-stage.ts`**

```ts
// src/modules/jobs/application/verify-stage.ts
import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Job } from "../domain/job";
import {
	RESULT_REPOSITORY,
	type ResultRepository,
} from "../domain/ports/result-repository.port";
import {
	RESULT_VERIFIER,
	type ResultVerifier,
	type VerifyVerdict,
} from "../domain/ports/result-verifier.port";
import type { Result } from "../domain/result";
import { VERIFY_CAP, VERIFY_CHUNK_SIZE, type VerifyInput } from "../domain/services/verify-prompt";

function chunk<T>(items: T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
	return out;
}

/**
 * Verify: judge each included Result against the Resolved Identity + Brand
 * Context (snippets only — Extract stays in Classify). A high-confidence
 * `mismatch` is Excluded (`off_topic`, detail "LLM"); everything softer is left
 * included and flagged `verified` or `uncertain`. Verify failure is a Warning,
 * never a Job failure (the reviewable list is the Job's purpose).
 */
@Injectable()
export class VerifyStage {
	private readonly logger = new Logger(VerifyStage.name);

	constructor(
		@Inject(RESULT_REPOSITORY) private readonly results: ResultRepository,
		@Inject(RESULT_VERIFIER) private readonly verifier: ResultVerifier,
	) {}

	async run(job: Job): Promise<void> {
		if (!this.verifier.isConfigured()) {
			job.addWarning("verification not configured — results left unverified");
			return;
		}
		const identity = job.resolvedIdentity;
		if (!identity?.context) {
			job.addWarning("no brand context — verification skipped, results left unverified");
			return;
		}

		let included = await this.results.findIncludedByJob(job.id);
		if (included.length === 0) return;
		if (included.length > VERIFY_CAP) {
			job.addWarning(`verified the first ${VERIFY_CAP} of ${included.length} results`);
			included = included.slice(0, VERIFY_CAP);
		}

		const chunks = chunk(included.map((r) => this.toInput(r)), VERIFY_CHUNK_SIZE);
		const outcomes = await Promise.allSettled(
			chunks.map((c) => this.verifier.verify(c, identity)),
		);

		const verdicts = new Map<string, VerifyVerdict>();
		let failedChunks = 0;
		for (const outcome of outcomes) {
			if (outcome.status === "rejected") {
				failedChunks++;
				continue;
			}
			for (const v of outcome.value) verdicts.set(v.id, v);
		}

		const writes: Promise<void>[] = [];
		let excluded = 0;
		let uncertain = 0;
		for (const r of included) {
			const v = verdicts.get(r.id);
			if (!v) continue;
			if (v.decision === "mismatch" && v.confidence === "high") {
				excluded++;
				writes.push(this.results.markExcluded(r.id, { code: "off_topic", detail: "LLM" }));
			} else if (v.decision === "match") {
				writes.push(this.results.setVerification(r.id, "verified"));
			} else {
				uncertain++;
				writes.push(this.results.setVerification(r.id, "uncertain"));
			}
		}
		await Promise.all(writes);

		if (failedChunks > 0) {
			job.addWarning(
				`${failedChunks}/${chunks.length} verification batches failed — those results left unverified`,
			);
		}
		this.logger.log(
			`verify ${job.id}: ${verdicts.size}/${included.length} verdicts, ${excluded} off_topic, ${uncertain} uncertain, ${failedChunks} batch failure(s)`,
		);
	}

	private toInput(r: Result): VerifyInput {
		return {
			id: r.id,
			snippet: r.snippet,
			sourceDomain: r.sourceDomain,
			title: r.title,
			url: r.url,
		};
	}
}
```

- [ ] **Step 4: Run it — expect PASS**

Run: `pnpm jest src/modules/jobs/application/verify-stage.spec.ts`
Expected: PASS (all 5).

- [ ] **Step 5: Commit**

```bash
git add src/modules/jobs/application/verify-stage.ts src/modules/jobs/application/verify-stage.spec.ts
git commit -m "feat(application): VerifyStage — entity verification before classify"
```

---

## Task 10: BrandFetch — Brand API enrichment + `fetchContext`

**Files:**
- Modify: `src/modules/jobs/domain/ports/brand-directory.port.ts`
- Modify: `src/modules/jobs/infrastructure/brandfetch/brandfetch-client.ts`
- Test: `src/modules/jobs/infrastructure/brandfetch/brandfetch-client.spec.ts`

> **Plan-time verification (do this first):** WebFetch `https://docs.brandfetch.com/brand-api/overview` and check for a distinct **Brand Context** endpoint and its response shape. If one exists, `fetchContext` calls it. **If not**, compose `BrandContext` from the Brand API response's company fields (`description`, `company.industries`, aliases/`name`) — the method signature and stored shape are identical either way. Record which path you took in the adapter's doc comment.

- [ ] **Step 1: Extend the port**

In `brand-directory.port.ts`:

```ts
import type { BrandContext } from "../brand-context";
// extend BrandProfile:
export type BrandProfile = {
	name: string;
	domain: string;
	handles: string[];
	description: string | null;
	industry: string | null;
};
// add to the interface:
	fetchContext(domain: string): Promise<BrandContext | null>;
```

- [ ] **Step 2: Write the failing test**

Use the existing spec's mocking style (it already stubs `fetch` — read the current file first). Add cases:

```ts
// add to brandfetch-client.spec.ts
describe("fetchContext", () => {
	it("returns null when unconfigured (no API key)", async () => {
		// construct client with a config whose get('BRANDFETCH_API_KEY') is ''
		// expect await client.fetchContext("acme.com") === null
	});
	it("composes a BrandContext from the brand response (description/industry/aliases)", async () => {
		// stub global.fetch to return a brand payload with description + industries
		// expect result.description to be the payload description
	});
	it("returns null on a non-OK response", async () => {
		// stub fetch → { ok: false, status: 404 }
		// expect null
	});
});
```

Fill these in concretely matching the existing spec's `fetch` stub pattern (mirror how `fetchProfile`/`search` are already tested in this same file).

- [ ] **Step 3: Run it — expect FAIL**

Run: `pnpm jest src/modules/jobs/infrastructure/brandfetch/brandfetch-client.spec.ts`
Expected: FAIL — `fetchContext` undefined / profile fields missing.

- [ ] **Step 4: Implement in `brandfetch-client.ts`**

Extend the `BrandResponse` zod schema to parse company fields, enrich `fetchProfile`'s return with `description`/`industry`, and add `fetchContext`. Example (adjust field paths to the confirmed API shape):

```ts
const BrandResponse = z.object({
	description: z.string().optional(),
	company: z.object({ industries: z.array(z.object({ name: z.string() })).optional() }).optional(),
	domain: z.string().optional(),
	links: z.array(BrandLink).optional(),
	name: z.string().optional(),
});

// in fetchProfile's return:
	description: parsed.data.description ?? null,
	industry: parsed.data.company?.industries?.[0]?.name ?? null,

// new method:
async fetchContext(domain: string): Promise<BrandContext | null> {
	const apiKey = this.config.get("BRANDFETCH_API_KEY");
	if (!apiKey) return null;
	try {
		const res = await fetch(
			`https://api.brandfetch.io/v2/brands/${encodeURIComponent(domain)}`,
			{ headers: { Authorization: `Bearer ${apiKey}` } },
		);
		if (!res.ok) {
			this.logger.warn(`brand context ${domain}: HTTP ${res.status}`);
			return null;
		}
		const parsed = BrandResponse.safeParse(await res.json());
		if (!parsed.success) return null;
		const description = parsed.data.description?.trim();
		if (!description) return null;
		return {
			aliases: parsed.data.name && parsed.data.name !== domain ? [parsed.data.name] : [],
			description,
			industry: parsed.data.company?.industries?.[0]?.name ?? null,
		};
	} catch (err) {
		this.logger.warn(`brand context ${domain} failed: ${String(err)}`);
		return null;
	}
}
```

(If the confirmed Brand Context API is a *separate* endpoint, point the `fetch` URL there and map its fields instead — same return shape.) Add `import type { BrandContext } from "../../domain/brand-context";`.

- [ ] **Step 5: Run it — expect PASS**

Run: `pnpm jest src/modules/jobs/infrastructure/brandfetch/brandfetch-client.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/modules/jobs/domain/ports/brand-directory.port.ts src/modules/jobs/infrastructure/brandfetch/
git commit -m "feat(brandfetch): Brand API field enrichment + fetchContext"
```

---

## Task 11: ResolveStage — attach Brand Context

**Files:**
- Modify: `src/modules/jobs/application/resolve-stage.ts`
- Test: `src/modules/jobs/application/resolve-stage.spec.ts`

- [ ] **Step 1: Write the failing test**

Read the existing `resolve-stage.spec.ts` for its `BrandDirectory`/`WebContext` stub style, then add (stubs must now also implement `fetchContext`):

```ts
it("attaches the brand context to the Resolved Identity", async () => {
	// brands stub: isConfigured()=true, fetchProfile→profile, fetchContext→
	//   { aliases: [], description: "A dev tools company.", industry: "Software" }
	// run resolve on a URL-provided job
	// expect job.resolvedIdentity?.context?.description === "A dev tools company."
});

it("warns when brand context is unavailable", async () => {
	// brands stub: fetchContext→null
	// expect a warning matching /brand context/ and context === null/undefined
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `pnpm jest src/modules/jobs/application/resolve-stage.spec.ts`
Expected: FAIL — context not attached.

- [ ] **Step 3: Edit `resolve-stage.ts`**

After the existing brand-profile block (inside `if (domain)` and `this.brands.isConfigured()`), fetch context; then include it on the identity. Add a local `let context: BrandContext | null = null;` near the other locals, populate it, and add `context` to the `identity` object literal:

```ts
// inside the `if (domain && this.brands.isConfigured())` area, after fetchProfile:
context = await this.brands.fetchContext(domain);
if (!context) {
	job.addWarning(`brand context for ${domain} unavailable — verification will run on name + domains only`);
}
```

```ts
const identity: ResolvedIdentity = {
	context,
	domains,
	handles,
	name,
	negativeMatches,
	provenance,
	window: job.window,
};
```

Add `import type { BrandContext } from "../domain/brand-context";` and declare `let context: BrandContext | null = null;` alongside `domains`/`handles`.

- [ ] **Step 4: Run it — expect PASS**

Run: `pnpm jest src/modules/jobs/application/resolve-stage.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/jobs/application/resolve-stage.ts src/modules/jobs/application/resolve-stage.spec.ts
git commit -m "feat(resolve): attach Brand Context to the Resolved Identity"
```

---

## Task 12: `WebSearchBackstop` port + NL queries + `AnthropicWebSearch`

**Files:**
- Create: `src/modules/jobs/domain/ports/web-search-backstop.port.ts`
- Modify: `src/modules/jobs/domain/services/search-queries.ts` (NL builders + threshold)
- Create: `src/modules/jobs/infrastructure/anthropic/anthropic-web-search.ts`
- Test: `src/modules/jobs/domain/services/search-queries.spec.ts` (add cases — confirm file exists; if not, create)
- Test: `src/modules/jobs/infrastructure/anthropic/anthropic-web-search.spec.ts` (degraded path)

> **Anthropic SDK note:** the `web_search` server tool type is `web_search_20250305` with `name: "web_search"`. Confirm via the **claude-api** skill before implementing. Results arrive as `web_search_tool_result` content blocks containing `web_search_result` items (`url`, `title`, `page_age`, `encrypted_content`).

- [ ] **Step 1: Create the port**

```ts
// src/modules/jobs/domain/ports/web-search-backstop.port.ts
import type { SearchHit } from "./search-provider.port";

export const WEB_SEARCH_BACKSTOP = Symbol("WEB_SEARCH_BACKSTOP");

/** A natural-language web search used as an accuracy backstop alongside Tavily. */
export interface WebSearchBackstop {
	search(naturalQuery: string): Promise<SearchHit[]>;
	isConfigured(): boolean;
}
```

- [ ] **Step 2: Add NL query builders + threshold (failing test first)**

```ts
// add to search-queries.spec.ts
import { buildBackstopQueries, buildEscalationQueries, TAVILY_THIN_THRESHOLD } from "./search-queries";

describe("backstop queries", () => {
	const identity = {
		domains: ["acme.com"], handles: [], name: "Acme",
		negativeMatches: [], provenance: "url_provided" as const,
		window: { end: "2026-06-08", start: "2023-06-08" },
	};
	it("builds 1-3 broad NL queries naming the company and domain", () => {
		const qs = buildBackstopQueries(identity);
		expect(qs.length).toBeGreaterThanOrEqual(1);
		expect(qs.length).toBeLessThanOrEqual(3);
		expect(qs.some((q) => q.includes("Acme"))).toBe(true);
	});
	it("escalation queries reuse the full angle set as plain strings", () => {
		expect(buildEscalationQueries(identity).length).toBeGreaterThan(5);
	});
	it("exposes a thin threshold", () => {
		expect(typeof TAVILY_THIN_THRESHOLD).toBe("number");
	});
});
```

- [ ] **Step 3: Run it — expect FAIL**

Run: `pnpm jest src/modules/jobs/domain/services/search-queries.spec.ts`
Expected: FAIL — exports missing.

- [ ] **Step 4: Implement in `search-queries.ts`**

```ts
/** Below this many usable Tavily results, escalate the Anthropic backstop to the full angle set. */
export const TAVILY_THIN_THRESHOLD = 5;

/** 1–3 broad natural-language queries for the Anthropic web-search backstop. */
export function buildBackstopQueries(identity: ResolvedIdentity): string[] {
	const { name } = identity;
	const domain = identity.domains[0];
	const queries = [
		domain
			? `recent news and coverage about "${name}" (${domain})`
			: `recent news and coverage about "${name}"`,
		`"${name}" funding OR acquisition OR launch OR partnership news`,
	];
	return queries;
}

/** The full angle set rendered as plain NL strings (escalation path). Deduped. */
export function buildEscalationQueries(identity: ResolvedIdentity): string[] {
	return [...new Set(buildSearchQueries(identity).map((q) => q.query))];
}
```

- [ ] **Step 5: Write the failing adapter degraded test**

```ts
// src/modules/jobs/infrastructure/anthropic/anthropic-web-search.spec.ts
import { AppConfigService } from "../../../../shared/config/app-config.service";
import { AnthropicWebSearch } from "./anthropic-web-search";

function config(key: string | undefined): AppConfigService {
	return { get: (k: string) => (k === "ANTHROPIC_API_KEY" ? key : "") } as unknown as AppConfigService;
}

describe("AnthropicWebSearch", () => {
	it("is unconfigured without a key", () => {
		expect(new AnthropicWebSearch(config(undefined)).isConfigured()).toBe(false);
	});
	it("returns [] when unconfigured", async () => {
		expect(await new AnthropicWebSearch(config(undefined)).search("anything")).toEqual([]);
	});
});
```

- [ ] **Step 6: Run it — expect FAIL**

Run: `pnpm jest src/modules/jobs/infrastructure/anthropic/anthropic-web-search.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 7: Create `anthropic-web-search.ts`**

```ts
// src/modules/jobs/infrastructure/anthropic/anthropic-web-search.ts
import Anthropic from "@anthropic-ai/sdk";
import { Injectable, Logger } from "@nestjs/common";
import { AppConfigService } from "../../../../shared/config/app-config.service";
import type { SearchHit } from "../../domain/ports/search-provider.port";
import type { WebSearchBackstop } from "../../domain/ports/web-search-backstop.port";

const SEARCH_MODEL = "claude-haiku-4-5";

function hostOf(url: string): string {
	try {
		return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
	} catch {
		return url;
	}
}

type WebSearchResultItem = { url?: string; title?: string; page_age?: string | null };

@Injectable()
export class AnthropicWebSearch implements WebSearchBackstop {
	private readonly logger = new Logger(AnthropicWebSearch.name);

	constructor(private readonly config: AppConfigService) {}

	isConfigured(): boolean {
		return Boolean(this.config.get("ANTHROPIC_API_KEY"));
	}

	async search(naturalQuery: string): Promise<SearchHit[]> {
		const apiKey = this.config.get("ANTHROPIC_API_KEY");
		if (!apiKey) return [];
		const client = new Anthropic({ apiKey });
		const response = await client.messages.create({
			max_tokens: 2048,
			messages: [{ content: `Search the web for: ${naturalQuery}`, role: "user" }],
			model: SEARCH_MODEL,
			tools: [{ max_uses: 3, name: "web_search", type: "web_search_20250305" }],
		});

		const hits: SearchHit[] = [];
		for (const block of response.content) {
			if (block.type !== "web_search_tool_result") continue;
			const items = (block.content ?? []) as WebSearchResultItem[];
			for (const item of items) {
				if (!item.url) continue;
				hits.push({
					content: null,
					publishedDate: item.page_age || null,
					score: null,
					sourceDomain: hostOf(item.url),
					title: item.title ?? "",
					url: item.url,
				});
			}
		}
		return hits;
	}
}
```

(Adjust the `web_search_tool_result` block typing to the SDK's actual exported types confirmed via claude-api; cast narrowly rather than using `any`.)

- [ ] **Step 8: Run both — expect PASS**

Run: `pnpm jest src/modules/jobs/domain/services/search-queries.spec.ts src/modules/jobs/infrastructure/anthropic/anthropic-web-search.spec.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/modules/jobs/domain/ports/web-search-backstop.port.ts src/modules/jobs/domain/services/search-queries.ts src/modules/jobs/domain/services/search-queries.spec.ts src/modules/jobs/infrastructure/anthropic/anthropic-web-search.ts src/modules/jobs/infrastructure/anthropic/anthropic-web-search.spec.ts
git commit -m "feat(search): WebSearchBackstop port, NL queries, AnthropicWebSearch adapter"
```

---

## Task 13: SearchStage — parallel fan-out + adaptive escalation

**Files:**
- Modify: `src/modules/jobs/application/search-stage.ts`
- Test: `src/modules/jobs/application/search-stage.spec.ts`

Behaviour:
1. Tavily set ∥ backstop broad NL queries, in parallel.
2. If usable Tavily inserts `< TAVILY_THIN_THRESHOLD` **and** backstop configured → run escalation NL queries through the backstop too.
3. Fail the Job only if **no** provider produced a successful response (both yielded zero successful responses), when at least one is configured.

- [ ] **Step 1: Write the failing tests**

Read the current `search-stage.spec.ts` stub style first, then add/adjust. Key new cases (stubs implement both `SearchProvider` and `WebSearchBackstop`):

```ts
it("merges Tavily and backstop hits in the default path", async () => {
	// tavily provider returns one hit per query; backstop returns one extra hit
	// expect inserted to include both the tavily and backstop URLs
});

it("escalates to the backstop's full angle set when Tavily is thin", async () => {
	// tavily returns < TAVILY_THIN_THRESHOLD usable hits;
	// spy backstop.search call count; expect it to be called more than the
	// default broad-query count (i.e. escalation fired)
});

it("does NOT escalate when Tavily is healthy", async () => {
	// tavily returns >= TAVILY_THIN_THRESHOLD hits; backstop called only the
	// default broad-query times
});

it("degrades to a Warning (no throw) when the backstop is unconfigured and Tavily yields zero but its queries succeed", async () => {
	// tavily configured, returns [] for every query (succeeds); backstop unconfigured
	// expect no throw, a warning, zero inserts
});

it("fails the Job only when both providers fail to produce any successful response", async () => {
	// tavily configured but every query rejects; backstop unconfigured
	// expect run() to reject
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `pnpm jest src/modules/jobs/application/search-stage.spec.ts`
Expected: FAIL — constructor arity / escalation logic missing.

- [ ] **Step 3: Rewrite `search-stage.ts`**

```ts
import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Job } from "../domain/job";
import { ID_GENERATOR, type IdGenerator } from "../domain/ports/id-generator.port";
import { RESULT_REPOSITORY, type ResultRepository } from "../domain/ports/result-repository.port";
import { SEARCH_PROVIDER, type SearchHit, type SearchProvider } from "../domain/ports/search-provider.port";
import { WEB_SEARCH_BACKSTOP, type WebSearchBackstop } from "../domain/ports/web-search-backstop.port";
import { Result } from "../domain/result";
import { normalizeUrl } from "../domain/services/normalize";
import {
	buildBackstopQueries,
	buildEscalationQueries,
	buildSearchQueries,
	TAVILY_THIN_THRESHOLD,
} from "../domain/services/search-queries";

@Injectable()
export class SearchStage {
	private readonly logger = new Logger(SearchStage.name);

	constructor(
		@Inject(SEARCH_PROVIDER) private readonly provider: SearchProvider,
		@Inject(WEB_SEARCH_BACKSTOP) private readonly backstop: WebSearchBackstop,
		@Inject(RESULT_REPOSITORY) private readonly results: ResultRepository,
		@Inject(ID_GENERATOR) private readonly ids: IdGenerator,
	) {}

	async run(job: Job): Promise<void> {
		const identity = job.resolvedIdentity;
		if (!identity) {
			job.addWarning("search skipped — no resolved identity");
			return;
		}
		const tavilyOn = this.provider.isConfigured();
		const backstopOn = this.backstop.isConfigured();
		if (!tavilyOn && !backstopOn) {
			job.addWarning("search not configured — no results fetched");
			return;
		}

		const tavilyQueries = buildSearchQueries(identity);
		const backstopQueries = buildBackstopQueries(identity);

		const [tavily, backstopDefault] = await Promise.all([
			tavilyOn
				? Promise.allSettled(tavilyQueries.map((q) => this.provider.search(q)))
				: Promise.resolve([]),
			backstopOn
				? Promise.allSettled(backstopQueries.map((q) => this.backstop.search(q)))
				: Promise.resolve([]),
		]);

		const tavily_ = this.tally(tavily);
		const backstop_ = this.tally(backstopDefault);
		let inserted = (await this.insertAll(job, tavily_.hits)) + (await this.insertAll(job, backstop_.hits));
		let anySucceeded = tavily_.succeeded > 0 || backstop_.succeeded > 0;

		// Escalation: Tavily thin → mirror the full angle set through the backstop.
		if (backstopOn && tavily_.inserted < TAVILY_THIN_THRESHOLD) {
			const escalated = await Promise.allSettled(
				buildEscalationQueries(identity).map((q) => this.backstop.search(q)),
			);
			const esc = this.tally(escalated);
			inserted += await this.insertAll(job, esc.hits);
			anySucceeded = anySucceeded || esc.succeeded > 0;
			this.logger.log(`search ${job.id}: escalated backstop (${esc.succeeded} ok)`);
		}

		if (tavilyOn && tavily_.failed > 0) {
			job.addWarning(`${tavily_.failed}/${tavilyQueries.length} Tavily search queries failed`);
		}
		if (backstopOn && backstop_.failed > 0) {
			job.addWarning(`${backstop_.failed}/${backstopQueries.length} backstop search queries failed`);
		}
		this.logger.log(`search ${job.id}: ${inserted} results inserted (tavily=${tavily_.inserted})`);

		if (!anySucceeded) {
			throw new Error("all search queries failed — no results fetched");
		}
	}

	// Collect settled provider outcomes: count ok/failed and flatten the hits;
	// `inserted` is set later — here we only carry the raw hits.
	private tally(outcomes: PromiseSettledResult<SearchHit[]>[]): {
		succeeded: number;
		failed: number;
		inserted: number;
		hits: SearchHit[];
	} {
		let succeeded = 0;
		let failed = 0;
		const hits: SearchHit[] = [];
		for (const o of outcomes) {
			if (o.status === "rejected") {
				failed++;
				continue;
			}
			succeeded++;
			hits.push(...o.value);
		}
		return { failed, hits, inserted: hits.length, succeeded };
	}

	private async insertAll(job: Job, hits: SearchHit[]): Promise<number> {
		let inserted = 0;
		for (const hit of hits) {
			let normalizedUrl: string;
			try {
				normalizedUrl = normalizeUrl(hit.url);
			} catch {
				continue;
			}
			const result = new Result(
				this.ids.next(),
				job.id,
				hit.url,
				normalizedUrl,
				hit.title,
				hit.sourceDomain,
				hit.publishedDate,
				hit.content,
				hit.score,
			);
			if (await this.results.insertIfNew(result)) inserted++;
		}
		return inserted;
	}
}
```

> Note: `tally().inserted` is the *hit count* before dedup; the escalation check uses Tavily's hit count as the "usable" proxy. If you prefer post-dedup counting, return inserted from `insertAll` and compare that — keep it simple and document whichever you pick.

- [ ] **Step 4: Run it — expect PASS**

Run: `pnpm jest src/modules/jobs/application/search-stage.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/jobs/application/search-stage.ts src/modules/jobs/application/search-stage.spec.ts
git commit -m "feat(search): parallel Tavily + Anthropic backstop with adaptive escalation"
```

---

## Task 14: Pipeline wiring + module DI

**Files:**
- Modify: `src/modules/jobs/application/pipeline.service.ts`
- Modify: `src/modules/jobs/jobs.module.ts`
- Test: build + full test run (the pipeline is integration-wired; rely on the stage specs + a compile check)

- [ ] **Step 1: Insert Verify into the pipeline**

In `pipeline.service.ts`: import `VerifyStage`, inject it (constructor param after `filter`), and add the stage between Filter and Classify in `run`:

```ts
import { VerifyStage } from "./verify-stage";
// constructor: add `private readonly verify: VerifyStage,` after filter
// in run(), after the filter block:
await this.enter(job, "verifying");
await this.verify.run(job);
await this.persist(job);
```

Keep the existing `await this.enter(job, "classifying");` block right after.

- [ ] **Step 2: Register providers in `jobs.module.ts`**

Add imports and providers:

```ts
import { VerifyStage } from "./application/verify-stage";
import { RESULT_VERIFIER } from "./domain/ports/result-verifier.port";
import { WEB_SEARCH_BACKSTOP } from "./domain/ports/web-search-backstop.port";
import { AnthropicWebSearch } from "./infrastructure/anthropic/anthropic-web-search";
import { HaikuVerifier } from "./infrastructure/anthropic/haiku-verifier";
```

In `providers`, add (keep grouped with the other port bindings + stages):

```ts
{ provide: RESULT_VERIFIER, useClass: HaikuVerifier },
{ provide: WEB_SEARCH_BACKSTOP, useClass: AnthropicWebSearch },
// ...and in the stage list:
VerifyStage,
```

- [ ] **Step 3: Build + full test run**

Run: `pnpm build`
Expected: no type errors (SearchStage's new 4-arg constructor is satisfied by DI; VerifyStage resolves its ports).
Run: `pnpm test`
Expected: all green.

- [ ] **Step 4: Lint**

Run: `pnpm lint:fix`
Expected: clean (fix any key-sort / import-order nits it reports).

- [ ] **Step 5: Commit**

```bash
git add src/modules/jobs/application/pipeline.service.ts src/modules/jobs/jobs.module.ts
git commit -m "feat(pipeline): wire VerifyStage and search backstop into the module"
```

---

## Task 15: Clipping Desk — surface `uncertain` + `off_topic`

**Files:**
- Modify: `src/modules/jobs/interface/view-model.ts`
- Test: `src/modules/jobs/interface/view-model.spec.ts`
- Modify: `views/_result_row.njk`
- Modify: `src/modules/jobs/interface/demo-fixtures.ts`

- [ ] **Step 1: Write the failing view-model test**

Read `view-model.spec.ts` first for its `Result`-building helper, then add:

```ts
it("exposes verificationStatus on included items", () => {
	// build an included Result, call result.setVerification("uncertain")
	// buildJobView(...).groups[...].items[0].verificationStatus === "uncertain"
});
it("labels the off_topic exclusion as 'Different company'", () => {
	// build an excluded Result with { code: "off_topic", detail: "LLM" }
	// buildJobView(...).excluded[...].label === "Different company"
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `pnpm jest src/modules/jobs/interface/view-model.spec.ts`
Expected: FAIL — `verificationStatus` missing from `ResultItemView`; `off_topic` label missing.

- [ ] **Step 3: Edit `view-model.ts`**

Add `off_topic: "Different company",` to `EXCLUSION_LABELS` (keys are alphabetical — it sorts after `ecommerce_review`/before `out_of_window`). Add `verificationStatus: string | null;` to `ResultItemView`. In `toItem`, add `verificationStatus: r.verificationStatus,` (keys sorted).

- [ ] **Step 4: Run it — expect PASS**

Run: `pnpm jest src/modules/jobs/interface/view-model.spec.ts`
Expected: PASS.

- [ ] **Step 5: Add the badge to `_result_row.njk`**

After the mono `<div>` (the source-domain/date line), add a quiet marker when uncertain — use existing DESIGN tokens (mirror the `low confidence` styling, but press-blue):

```njk
{% if item.verificationStatus == "uncertain" %}
<div class="mono mt-1">
	<span class="text-press-blue-deep">uncertain — may not be about this company</span>
</div>
{% endif %}
```

> Run the visual treatment through `/impeccable` before finalising — confirm the marker reads as low-emphasis against confident results and matches `DESIGN.md` (hairline, newsprint, single accent).

- [ ] **Step 6: Add an uncertain + an off_topic fixture**

In `demo-fixtures.ts`: give one included `DemoHit` an uncertain marker and add an excluded `off_topic` hit. Add a `verification?: "verified" | "uncertain"` field to the `DemoHit` type, set it on one included hit, and after constructing the non-excluded `Result`, call `.setVerification(hit.verification)` when present. Add an excluded hit:

```ts
{
	date: "2025-09-12",
	domain: "acmefoods.com",
	exclude: { code: "off_topic", detail: "LLM" },
	title: "Acme Foods recalls a product line",
	type: null,
	url: "https://acmefoods.com/recall",
},
```

- [ ] **Step 7: Verify the demo renders**

Run: `docker compose up -d postgres redis && pnpm db:migrate && pnpm build:client && pnpm dev` (separate terminal), then `curl -i localhost:3000/demo` and open the returned Job URL.
Expected: the `uncertain` marker shows on the flagged included Result; the Excluded section shows a "Different company" group.

- [ ] **Step 8: Commit**

```bash
git add src/modules/jobs/interface/view-model.ts src/modules/jobs/interface/view-model.spec.ts src/modules/jobs/interface/demo-fixtures.ts views/_result_row.njk
git commit -m "feat(ui): surface uncertain marker and off_topic exclusion in the Clipping Desk"
```

---

## Task 16: Docs reconciliation

**Files:**
- Modify: `CONTEXT.md`
- Modify: `.env.example`
- Modify: `docs/aglow-writeup.md`

- [ ] **Step 1: `CONTEXT.md`**

- In **Exclusion**, add `off_topic` to the closed set and define it: *"the Result is about a different entity, not the target company (the Verify stage's high-confidence mismatch)."* Note `exclusion_detail = "LLM"` records the catcher, as with the other LLM-caught codes.
- Add a **Verification** term (or extend the pipeline description): *"a per-Result judgement (`verified` | `uncertain`) made by the Verify stage from title/snippet/URL against the Resolved Identity's Brand Context; a high-confidence mismatch is Excluded (`off_topic`), softer judgements stay included and are marked."*
- Extend **Resolved Identity** to mention the optional **Brand Context** (description/industry/aliases) used by Verify and Classify.
- Update the pipeline/stage list to include **Verify** between Filter and Classify.

- [ ] **Step 2: `.env.example`**

Under the Anthropic line, note it now also powers the web-search backstop and the Verify stage (one key, three signals). Under BrandFetch, note it now also fetches Brand Context. No new keys.

- [ ] **Step 3: `docs/aglow-writeup.md`**

Add a short subsection covering: the Verify stage and `off_topic`; the Brand Context enrichment; the adaptive Anthropic backstop; and a **cost note** — the backstop fires 1–3 `web_search` tool calls by default and only mirrors the full angle set when Tavily is thin; Verify adds one Haiku pass over snippets (capped at `VERIFY_CAP`).

- [ ] **Step 4: Commit**

```bash
git add CONTEXT.md .env.example docs/aglow-writeup.md
git commit -m "docs: reconcile CONTEXT/env/writeup for Verify, Brand Context, search backstop"
```

---

## Final verification

- [ ] `pnpm test` — all green.
- [ ] `pnpm lint:fix` — clean.
- [ ] `pnpm build` — no type errors.
- [ ] `curl localhost:3000/demo` — Clipping Desk shows the uncertain marker and the "Different company" excluded group.
- [ ] Re-read the spec §2–§7 and confirm each requirement maps to a shipped task.

---

## Self-review notes (author)

- **Spec coverage:** §3 → Tasks 10–11; §4 → Tasks 12–13; §5 → Tasks 7–9; §6 → Tasks 1,3,5,6; §2 (status edge) → Task 2; §7 (UI) → Task 15; §10 (docs) → Task 16. No gaps.
- **Type consistency:** `VerificationStatus` (result.ts) used by repo port (Task 6), VerifyStage (Task 9), view-model (Task 15). `VerifyVerdict`/`VerifyInput`/`VerifyDecision` defined in Task 7/8 and consumed in Task 9. `BrandContext` (Task 4) used by Tasks 5,6,10,11 + classify/verify prompts. `WebSearchBackstop`/`SearchHit` (Task 12) consumed by Task 13. `off_topic` (Task 1) used by Tasks 9,15,16.
- **Open items flagged for the implementer:** (a) confirm the BrandFetch Brand Context endpoint vs the compose-from-Brand-API fallback (Task 10); (b) confirm the Anthropic `web_search` tool type + structured-output call shape via the **claude-api** skill (Tasks 8,12); (c) `/impeccable` pass on the uncertain marker (Task 15).
