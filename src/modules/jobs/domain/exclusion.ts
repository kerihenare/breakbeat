// Soft Exclusion — the only status transition a Result undergoes. Codes record
// *why* (closed set), never which stage caught it; detail is human-readable.
export type ExclusionCode =
	| "own_channel"
	| "aggregator"
	| "ecommerce_review"
	| "out_of_window"
	| "duplicate";

export const EXCLUSION_CODES: readonly ExclusionCode[] = [
	"own_channel",
	"aggregator",
	"ecommerce_review",
	"out_of_window",
	"duplicate",
];

export type Exclusion = {
	readonly code: ExclusionCode;
	readonly detail: string | null;
};

export type Confidence = "high" | "low";

export const CONFIDENCES: readonly Confidence[] = ["high", "low"];
