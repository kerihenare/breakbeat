/**
 * Normalize a raw URL or hostname string to a bare lowercased hostname.
 *
 * Rules:
 * - Parse as a URL; on success, use the `hostname` (never `host`, so ports are dropped)
 * - Lowercase the result
 * - Strip a leading `www.` prefix
 * - On parse failure (no scheme, plain name, etc.) return `raw.trim().toLowerCase()`
 *
 * Examples:
 *   normalizeHost("https://www.Acme.com/x") → "acme.com"
 *   normalizeHost("acme.com")               → "acme.com"  (fallback)
 *   normalizeHost("  ACME Corp  ")          → "acme corp" (fallback)
 */
export function normalizeHost(raw: string): string {
	try {
		const parsed = new URL(raw);
		// Use hostname (strips port) then lowercase
		let host = parsed.hostname.toLowerCase();
		if (host.startsWith("www.")) {
			host = host.slice(4);
		}
		return host;
	} catch {
		// Not a parseable URL — return trimmed lowercase as-is
		return raw.trim().toLowerCase();
	}
}
