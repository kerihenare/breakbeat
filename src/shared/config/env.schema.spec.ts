import { parseEnv } from "./env.schema";

const base = {
	DATABASE_URL: "postgres://breakbeat:breakbeat@localhost:5432/breakbeat",
	NODE_ENV: "test",
	PORT: "3000",
	REDIS_URL: "redis://localhost:6379",
	VICTORIALOGS_URL: "http://localhost:9428",
};

describe("parseEnv", () => {
	it("parses a valid environment with infra defaults", () => {
		const { env } = parseEnv(base);
		expect(env.PORT).toBe(3000);
		expect(env.DATABASE_URL).toContain("postgres://");
	});

	it("throws with the offending variable named when a required infra var is malformed", () => {
		expect(() => parseEnv({ ...base, DATABASE_URL: "not-a-url" })).toThrow(
			/DATABASE_URL/,
		);
	});

	it("warns (does not throw) when external API keys are absent", () => {
		const { env, warnings } = parseEnv(base);
		expect(env.ANTHROPIC_API_KEY).toBeUndefined();
		expect(warnings.some((w) => w.includes("ANTHROPIC_API_KEY"))).toBe(true);
		expect(warnings.some((w) => w.includes("SENTRY_DSN"))).toBe(true);
	});

	it("applies defaults for PORT and NODE_ENV when omitted", () => {
		const { env } = parseEnv({
			DATABASE_URL: base.DATABASE_URL,
			REDIS_URL: base.REDIS_URL,
			VICTORIALOGS_URL: base.VICTORIALOGS_URL,
		});
		expect(env.PORT).toBe(3000);
		expect(env.NODE_ENV).toBe("development");
	});

	it("treats empty-string API keys (the .env unset form) as absent, not invalid", () => {
		const { env, warnings } = parseEnv({ ...base, ANTHROPIC_API_KEY: "" });
		expect(env.ANTHROPIC_API_KEY).toBeUndefined();
		expect(warnings.some((w) => w.includes("ANTHROPIC_API_KEY"))).toBe(true);
	});

	it("reports an empty-string required infra var as missing", () => {
		expect(() => parseEnv({ ...base, DATABASE_URL: "" })).toThrow(
			/DATABASE_URL/,
		);
	});
});
