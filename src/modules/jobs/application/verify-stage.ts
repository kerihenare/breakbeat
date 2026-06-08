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
import {
	VERIFY_CAP,
	VERIFY_CHUNK_SIZE,
	type VerifyInput,
} from "../domain/services/verify-prompt";

function chunk<T>(items: T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size)
		out.push(items.slice(i, i + size));
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
			job.addWarning(
				"no brand context — verification skipped, results left unverified",
			);
			return;
		}

		let included = await this.results.findIncludedByJob(job.id);
		if (included.length === 0) return;
		if (included.length > VERIFY_CAP) {
			job.addWarning(
				`verified the first ${VERIFY_CAP} of ${included.length} results`,
			);
			included = included.slice(0, VERIFY_CAP);
		}

		const chunks = chunk(
			included.map((r) => this.toInput(r)),
			VERIFY_CHUNK_SIZE,
		);
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
				writes.push(
					this.results.markExcluded(r.id, { code: "off_topic", detail: "LLM" }),
				);
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
