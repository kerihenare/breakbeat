import type { ContentType } from "../content-type";
import type { Confidence } from "../exclusion";
import type { ResolvedIdentity } from "../resolved-identity";
import type {
	ClassifyExclude,
	ClassifyInput,
} from "../services/classify-prompt";

export const CLASSIFIER = Symbol("CLASSIFIER");

export type ClassifyVerdict = {
	id: string;
	contentType: ContentType;
	exclude: ClassifyExclude;
	confidence: Confidence;
};

/** Classifies a chunk of Results (Claude Haiku, structured outputs). */
export interface Classifier {
	classify(
		inputs: ClassifyInput[],
		identity: ResolvedIdentity,
	): Promise<ClassifyVerdict[]>;
	isConfigured(): boolean;
}
