import { join } from "node:path";
import { Injectable } from "@nestjs/common";
import * as nunjucks from "nunjucks";

/**
 * Renders Nunjucks templates to strings (autoescape on — the XSS guarantee for
 * untrusted Result titles/snippets; `| safe` is the only, greppable opt-out).
 * Used by controllers and the SSE endpoint alike. Templates live in top-level
 * `views/`, loaded from cwd so this works under `pnpm dev` and `node dist`.
 */
@Injectable()
export class ViewRenderer {
	private readonly env: nunjucks.Environment;

	constructor() {
		this.env = new nunjucks.Environment(
			new nunjucks.FileSystemLoader(join(process.cwd(), "views"), {
				noCache: process.env.NODE_ENV !== "production",
			}),
			{ autoescape: true, throwOnUndefined: false },
		);
	}

	render(template: string, context: Record<string, unknown> = {}): string {
		return this.env.render(template, context);
	}
}
