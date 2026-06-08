import { html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";

const TERMINAL = new Set(["done", "done_with_warnings", "failed"]);
const LABELS: Record<string, string> = {
	classifying: "Classifying",
	done: "Done",
	done_with_warnings: "Done · warnings",
	extracting: "Extracting",
	failed: "Failed",
	filtering: "Filtering",
	pending: "Pending",
	refining: "Refining",
	resolving: "Resolving",
	searching: "Searching",
};

/**
 * Status chip. Light DOM so the Drumbeat utility/brand classes apply.
 * Pulses while running; static under prefers-reduced-motion (CSS handles that).
 *
 * Set `live` on the single chip that updates in place (the job header, driven
 * by SSE) so transitions are announced. Leave it off for static chips rendered
 * in lists (e.g. the recent-jobs rail) — otherwise every row becomes its own
 * `role="status"` live region and a screen reader narrates the whole list.
 */
@customElement("bb-job-status")
export class BbJobStatus extends LitElement {
	@property() status = "pending";
	@property({ type: Boolean }) live = false;
	@property({ type: Boolean }) quiet = false;

	protected createRenderRoot(): HTMLElement {
		return this;
	}

	render() {
		const running = !TERMINAL.has(this.status);
		const label = LABELS[this.status] ?? this.status;

		// Quiet variant: a status dot + muted label for dense, inactive lists
		// (recent-jobs rail). A wall of filled pills reads as alarm; the dot
		// still carries the colour signal, the label keeps it non-colour-only.
		if (this.quiet) {
			return html`<span class="bb-status-quiet"
				><span
					class="bb-dot status-${this.status} ${running ? "is-running" : ""}"
				></span
				>${label}</span
			>`;
		}

		const cls = `bb-status status-${this.status} ${running ? "is-running" : ""}`;
		return this.live
			? html`<span class=${cls} role="status" aria-live="polite">${label}</span>`
			: html`<span class=${cls}>${label}</span>`;
	}
}
