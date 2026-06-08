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
	verify(
		inputs: VerifyInput[],
		identity: ResolvedIdentity,
	): Promise<VerifyVerdict[]>;
	isConfigured(): boolean;
}
