import { LitElement } from "lit";
import { customElement } from "lit/decorators.js";

/**
 * Content-type filter tabs. Light DOM: wraps server-rendered
 * `<button data-type="...">` tabs and toggles `.result-group[data-filter-type]`
 * visibility client-side (instant, no round trip — the full set ships with the
 * job). Roving tabindex + arrow keys; degrades to all-visible groups without JS.
 */
@customElement("bb-result-filter")
export class BbResultFilter extends LitElement {
	private tabs: HTMLButtonElement[] = [];

	protected createRenderRoot(): HTMLElement {
		return this;
	}

	firstUpdated(): void {
		this.tabs = Array.from(
			this.querySelectorAll<HTMLButtonElement>("button[data-type]"),
		);
		this.tabs.forEach((tab, i) => {
			tab.tabIndex = i === 0 ? 0 : -1;
			tab.addEventListener("click", () => this.select(tab));
			tab.addEventListener("keydown", (e) => this.onKey(e, i));
		});
		if (this.tabs[0]) this.select(this.tabs[0]);
	}

	private select(active: HTMLButtonElement): void {
		const type = active.dataset.type ?? "all";
		for (const tab of this.tabs) {
			const on = tab === active;
			tab.classList.toggle("is-active", on);
			tab.setAttribute("aria-selected", on ? "true" : "false");
		}
		const groups = document.querySelectorAll<HTMLElement>(".result-group");
		for (const group of groups) {
			const show = type === "all" || group.dataset.filterType === type;
			group.hidden = !show;
		}
	}

	private onKey(e: KeyboardEvent, i: number): void {
		let next = i;
		if (e.key === "ArrowRight") next = (i + 1) % this.tabs.length;
		else if (e.key === "ArrowLeft")
			next = (i - 1 + this.tabs.length) % this.tabs.length;
		else return;
		e.preventDefault();
		for (const [j, tab] of this.tabs.entries())
			tab.tabIndex = j === next ? 0 : -1;
		this.tabs[next]?.focus();
	}
}
