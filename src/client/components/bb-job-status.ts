import { html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";

const TERMINAL = new Set(["done", "done_with_warnings", "failed"]);
const LABELS: Record<string, string> = {
	classifying: "Classifying",
	done: "Done",
	done_with_warnings: "Done · warnings",
	failed: "Failed",
	filtering: "Filtering",
	pending: "Pending",
	resolving: "Resolving",
	searching: "Searching",
};

/**
 * Live status chip. Light DOM so the Drumbeat utility/brand classes apply.
 * Pulses while running; static under prefers-reduced-motion (CSS handles that).
 * `aria-live` announces transitions.
 */
@customElement("bb-job-status")
export class BbJobStatus extends LitElement {
	@property() status = "pending";

	protected createRenderRoot(): HTMLElement {
		return this;
	}

	render() {
		const running = !TERMINAL.has(this.status);
		return html`<span
			class="bb-status status-${this.status} ${running ? "is-running" : ""}"
			role="status"
			aria-live="polite"
			>${LABELS[this.status] ?? this.status}</span
		>`;
	}
}
