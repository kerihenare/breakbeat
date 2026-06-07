import Anthropic from "@anthropic-ai/sdk";
import { Injectable } from "@nestjs/common";
import { AppConfigService } from "../../../../shared/config/app-config.service";
import { parseEnum } from "../../../../shared/util/parse-enum";
import { CONTENT_TYPES } from "../../domain/content-type";
import { CONFIDENCES } from "../../domain/exclusion";
import type {
	Classifier,
	ClassifyVerdict,
} from "../../domain/ports/classifier.port";
import type { ResolvedIdentity } from "../../domain/resolved-identity";
import {
	buildClassifyPrompt,
	CLASSIFY_MODEL,
	type ClassifyExclude,
	type ClassifyInput,
	type ClassifyVerdictRaw,
	RESPONSE_SCHEMA,
	validateResultIds,
} from "../../domain/services/classify-prompt";

const EXCLUDES: ClassifyExclude[] = [
	"none",
	"own_channel",
	"ecommerce_review",
	"aggregator",
];

@Injectable()
export class HaikuClassifier implements Classifier {
	constructor(private readonly config: AppConfigService) {}

	isConfigured(): boolean {
		return Boolean(this.config.get("ANTHROPIC_API_KEY"));
	}

	async classify(
		inputs: ClassifyInput[],
		identity: ResolvedIdentity,
	): Promise<ClassifyVerdict[]> {
		const apiKey = this.config.get("ANTHROPIC_API_KEY");
		if (!apiKey || inputs.length === 0) return [];
		const client = new Anthropic({ apiKey });

		const response = await client.beta.messages.create({
			max_tokens: 4096,
			messages: [
				{ content: buildClassifyPrompt(inputs, identity), role: "user" },
			],
			model: CLASSIFY_MODEL,
			output_config: {
				format: { schema: RESPONSE_SCHEMA, type: "json_schema" },
			},
			system:
				"You are a precise content classifier. Return only valid JSON matching the requested schema. No markdown fences, no commentary.",
		});

		const textBlock = response.content.find((b) => b.type === "text");
		if (textBlock?.type !== "text") {
			throw new Error("no text block in classifier response");
		}
		const parsed = JSON.parse(textBlock.text) as {
			results?: ClassifyVerdictRaw[];
		};
		if (!Array.isArray(parsed.results)) {
			throw new Error("classifier response missing results array");
		}

		const sent = new Set(inputs.map((i) => i.id));
		const { valid } = validateResultIds(sent, parsed.results);
		return valid.map((v) => ({
			confidence: parseEnum(v.confidence, CONFIDENCES, "confidence"),
			contentType: parseEnum(v.content_type, CONTENT_TYPES, "content_type"),
			exclude: EXCLUDES.includes(v.exclude) ? v.exclude : "none",
			id: v.id,
		}));
	}
}
