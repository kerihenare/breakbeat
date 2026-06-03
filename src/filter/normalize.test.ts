import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { normalizeHost } from "./normalize.ts";

describe("normalizeHost", () => {
	it("extracts and lowercases the host from a full URL", () => {
		assert.equal(normalizeHost("https://www.Acme.com/x"), "acme.com");
	});

	it("strips www. prefix", () => {
		assert.equal(normalizeHost("https://www.example.com/path"), "example.com");
	});

	it("lowercases the host", () => {
		assert.equal(normalizeHost("https://EXAMPLE.COM/"), "example.com");
	});

	it("does not strip non-www subdomains", () => {
		assert.equal(
			normalizeHost("https://blog.example.com/"),
			"blog.example.com",
		);
	});

	it("handles URLs without paths", () => {
		assert.equal(normalizeHost("https://acme.com"), "acme.com");
	});

	it("handles http scheme", () => {
		assert.equal(normalizeHost("http://www.example.com/"), "example.com");
	});

	it("falls back to lowercase trimmed input for bare domain (no scheme)", () => {
		assert.equal(normalizeHost("acme.com"), "acme.com");
	});

	it("falls back to lowercase trimmed input for invalid URL", () => {
		assert.equal(normalizeHost("  ACME Corp  "), "acme corp");
	});

	it("handles empty string gracefully", () => {
		assert.equal(normalizeHost(""), "");
	});

	it("handles URL with port (strips www. but keeps host:port would be unusual — just host)", () => {
		// port is part of host in URL API; normalizeHost returns hostname only (no port)
		assert.equal(normalizeHost("https://www.example.com:8080/"), "example.com");
	});

	it("handles mixed case www. prefix", () => {
		// The www-strip should apply after lowercase
		assert.equal(normalizeHost("https://WWW.Example.COM/"), "example.com");
	});
});
