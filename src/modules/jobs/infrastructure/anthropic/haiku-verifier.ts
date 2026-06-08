import Anthropic from "@anthropic-ai/sdk";
import { Injectable } from "@nestjs/common";
import { AppConfigService } from "../../../../shared/config/app-config.service";
import { parseEnum } from "../../../../shared/util/parse-enum";
import { CONFIDENCES } from "../../domain/exclusion";
import type {
	ResultVerifier,
	VerifyDecision,
	VerifyVerdict,
} from "../../domain/ports/result-verifier.port";
import type { ResolvedIdentity } from "../../domain/resolved-identity";
import { validateResultIds } from "../../domain/services/classify-prompt";
import {
	buildVerifyPrompt,
	VERIFY_MODEL,
	VERIFY_RESPONSE_SCHEMA,
	type VerifyInput,
	type VerifyVerdictRaw,
} from "../../domain/services/verify-prompt";

const DECISIONS: VerifyDecision[] = ["match", "mismatch", "uncertain"];

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
			messages: [
				{ content: buildVerifyPrompt(inputs, identity), role: "user" },
			],
			model: VERIFY_MODEL,
			output_config: {
				format: { schema: VERIFY_RESPONSE_SCHEMA, type: "json_schema" },
			},
			system:
				"You are a precise content classifier. Return only valid JSON matching the requested schema. No markdown fences, no commentary.",
		});

		const textBlock = response.content.find((b) => b.type === "text");
		if (textBlock?.type !== "text") {
			throw new Error("no text block in verifier response");
		}
		const parsed = JSON.parse(textBlock.text) as {
			results?: VerifyVerdictRaw[];
		};
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
