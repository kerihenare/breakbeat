import { assertTransition, isTerminal, type JobStatus } from "./job-status";
import type { IdentityProvenance, ResolvedIdentity } from "./resolved-identity";
import type { Warning } from "./warning";
import type { SearchWindow } from "./window";

type JobState = {
	status?: JobStatus;
	provenance?: IdentityProvenance | null;
	warnings?: Warning[];
	error?: string | null;
	chosenDomain?: string | null;
	resolvedIdentity?: ResolvedIdentity | null;
	contextNote?: string | null;
};

/**
 * One run of the pipeline for one company, moving through the state machine
 * from `pending` to a terminal state. The company input (name/URL) is durable
 * raw input; the Resolved Identity is established fresh per run.
 */
export class Job {
	status: JobStatus;
	provenance: IdentityProvenance | null;
	error: string | null;
	chosenDomain: string | null;
	resolvedIdentity: ResolvedIdentity | null;
	contextNote: string | null;
	private readonly _warnings: Warning[];

	constructor(
		readonly id: string,
		readonly companyName: string,
		readonly homepageUrl: string | null,
		readonly window: SearchWindow,
		readonly createdAt: Date,
		state: JobState = {},
	) {
		this.status = state.status ?? "pending";
		this.provenance = state.provenance ?? null;
		this.error = state.error ?? null;
		this.chosenDomain = state.chosenDomain ?? null;
		this.resolvedIdentity = state.resolvedIdentity ?? null;
		this.contextNote = state.contextNote ?? null;
		this._warnings = state.warnings ? [...state.warnings] : [];
	}

	/** Record the Resolved Identity produced by the Resolve stage. */
	attachResolvedIdentity(identity: ResolvedIdentity): void {
		this.resolvedIdentity = identity;
		this.provenance = identity.provenance;
	}

	get warnings(): readonly Warning[] {
		return this._warnings;
	}

	get isTerminal(): boolean {
		return isTerminal(this.status);
	}

	/** Validate and apply a status transition; throws on an illegal edge. */
	transitionTo(to: JobStatus, error?: string): void {
		assertTransition(this.status, to);
		this.status = to;
		if (to === "failed") this.error = error ?? null;
	}

	addWarning(message: string): void {
		this._warnings.push({ message });
	}

	/** Resolve a non-failed terminal: `done_with_warnings` iff any Warning. */
	finalize(): void {
		this.transitionTo(
			this._warnings.length > 0 ? "done_with_warnings" : "done",
		);
	}
}
