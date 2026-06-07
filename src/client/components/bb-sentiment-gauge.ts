import { css, html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";

/**
 * Accessible sentiment summary: a horizontal stacked bar (positive/neutral/
 * negative) with labelled counts — color is never the sole carrier. Shadow DOM,
 * styled with the inherited Drumbeat CSS custom properties (they pierce shadow).
 * Width animates on mount; instant under prefers-reduced-motion.
 */
@customElement("bb-sentiment-gauge")
export class BbSentimentGauge extends LitElement {
	@property({ type: Number }) positive = 0;
	@property({ type: Number }) neutral = 0;
	@property({ type: Number }) negative = 0;

	static styles = css`
		:host { display: block; }
		.bar {
			display: flex;
			height: 0.75rem;
			border-radius: 9999px;
			overflow: hidden;
			border: 1px solid var(--color-border-hair, #ebe0d8);
			background: var(--color-newsprint-muted, #f7f3ef);
		}
		.seg { height: 100%; transition: width 0.3s ease-out; }
		.pos { background: var(--color-live-green, #25b566); }
		.neu { background: var(--color-text-dimmed, #6f6b6b); }
		.neg { background: var(--color-alert-coral, #e85a68); }
		.labels {
			display: flex;
			gap: 1rem;
			margin-top: 0.5rem;
			font-size: 0.8125rem;
			color: var(--color-text-muted, #5c5959);
		}
		.dot { display: inline-block; width: 0.6rem; height: 0.6rem; border-radius: 9999px; margin-right: 0.35rem; vertical-align: middle; }
		@media (prefers-reduced-motion: reduce) {
			.seg { transition: none; }
		}
	`;

	private pct(n: number, total: number): string {
		return total === 0 ? "0%" : `${Math.round((n / total) * 100)}%`;
	}

	render() {
		const total = this.positive + this.neutral + this.negative;
		return html`
			<div
				class="bar"
				role="img"
				aria-label="Sentiment: ${this.positive} positive, ${this.neutral} neutral, ${this.negative} negative"
			>
				<div class="seg pos" style="width:${this.pct(this.positive, total)}"></div>
				<div class="seg neu" style="width:${this.pct(this.neutral, total)}"></div>
				<div class="seg neg" style="width:${this.pct(this.negative, total)}"></div>
			</div>
			<div class="labels">
				<span><span class="dot pos"></span>Positive ${this.positive}</span>
				<span><span class="dot neu"></span>Neutral ${this.neutral}</span>
				<span><span class="dot neg"></span>Negative ${this.negative}</span>
			</div>
		`;
	}
}
