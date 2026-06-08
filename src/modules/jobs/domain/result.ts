import type { ContentType } from "./content-type";
import type { Confidence, Exclusion, ExclusionCode } from "./exclusion";

export type ResultStatus = "included" | "excluded";

export const RESULT_STATUSES: readonly ResultStatus[] = [
	"included",
	"excluded",
];

// Net-new, mocked in v1 (DESIGN-BRIEF §2) — populated by the UI fixtures / a
// future sentiment pass; nullable in the domain.
export type Sentiment = "positive" | "neutral" | "negative";

export const SENTIMENTS: readonly Sentiment[] = [
	"positive",
	"neutral",
	"negative",
];

export type VerificationStatus = "verified" | "uncertain";

export const VERIFICATION_STATUSES: readonly VerificationStatus[] = [
	"verified",
	"uncertain",
];

type ResultState = {
	status?: ResultStatus;
	exclusion?: Exclusion | null;
	contentType?: ContentType | null;
	confidence?: Confidence | null;
	sentiment?: Sentiment | null;
	verificationStatus?: VerificationStatus | null;
};

/**
 * One search hit, scoped to a Job. Born `included`; soft Exclusion is the only
 * status transition. Search gives us title + snippet; the Classify stage may
 * Extract full page text (via Tavily) for survivors to re-classify them — we
 * never fetch a Result page ourselves (the URL is the link target;
 * normalizedUrl is the dedup key).
 */
export class Result {
	status: ResultStatus;
	exclusion: Exclusion | null;
	contentType: ContentType | null;
	confidence: Confidence | null;
	sentiment: Sentiment | null;
	verificationStatus: VerificationStatus | null;

	constructor(
		readonly id: string,
		readonly jobId: string,
		readonly url: string,
		readonly normalizedUrl: string,
		readonly title: string,
		readonly sourceDomain: string,
		readonly publishedDate: string | null,
		readonly snippet: string | null = null,
		// Provider relevance score (Tavily 0–1); null when absent. Search-origin,
		// immutable — available for ranking/Collapse, not a status transition.
		readonly score: number | null = null,
		state: ResultState = {},
	) {
		this.status = state.status ?? "included";
		this.exclusion = state.exclusion ?? null;
		this.contentType = state.contentType ?? null;
		this.confidence = state.confidence ?? null;
		this.sentiment = state.sentiment ?? null;
		this.verificationStatus = state.verificationStatus ?? null;
		// Invariant: excluded ⟺ carries an Exclusion. Guards against a corrupt
		// row or mapper bug constructing an inconsistent Result.
		if (this.status === "excluded" && this.exclusion === null) {
			throw new Error("Result is excluded but has no Exclusion");
		}
		if (this.status === "included" && this.exclusion !== null) {
			throw new Error("Result is included but carries an Exclusion");
		}
	}

	get isExcluded(): boolean {
		return this.status === "excluded";
	}

	/** Soft-exclude. Idempotent: the first Exclusion wins (nothing un-excludes). */
	exclude(code: ExclusionCode, detail: string | null): void {
		if (this.status === "excluded") return;
		this.status = "excluded";
		this.exclusion = { code, detail };
	}

	classify(contentType: ContentType | null, confidence: Confidence): void {
		this.contentType = contentType;
		this.confidence = confidence;
	}

	/** Record the Verify stage's entity-relevance judgement. */
	setVerification(status: VerificationStatus): void {
		this.verificationStatus = status;
	}
}
