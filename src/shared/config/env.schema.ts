import { z } from "zod";

const urlString = z.string().url();

const schema = z.object({
	// External integrations — optional so a keyless clone still boots.
	ANTHROPIC_API_KEY: z.string().min(1).optional(),
	BRANDFETCH_API_KEY: z.string().min(1).optional(),
	BRANDFETCH_CLIENT_ID: z.string().min(1).optional(),
	DATABASE_URL: urlString,
	GOOGLE_API_KEY: z.string().min(1).optional(),
	GOOGLE_CX: z.string().min(1).optional(),
	NODE_ENV: z
		.enum(["development", "test", "production"])
		.default("development"),
	PORT: z.coerce.number().int().positive().default(3000),
	REDIS_URL: urlString,
	SENTRY_DSN: z.string().min(1).optional(),
	TAVILY_API_KEY: z.string().min(1).optional(),
	VICTORIALOGS_URL: urlString.optional(),
});

export type Env = z.infer<typeof schema>;

const OPTIONAL_INTEGRATIONS: (keyof Env)[] = [
	"ANTHROPIC_API_KEY",
	"TAVILY_API_KEY",
	"BRANDFETCH_API_KEY",
	"BRANDFETCH_CLIENT_ID",
	"GOOGLE_API_KEY",
	"GOOGLE_CX",
	"SENTRY_DSN",
	"VICTORIALOGS_URL",
];

/**
 * Validates the process environment. Required infra vars throw (naming the
 * offender); optional external integrations produce warnings instead, so a
 * freshly cloned, keyless checkout still boots.
 */
export function parseEnv(raw: Record<string, unknown>): {
	env: Env;
	warnings: string[];
} {
	// Treat empty-string env values (the .env representation of "unset") as
	// absent, so optional integrations warn rather than failing .min(1) and
	// genuinely-missing required vars report as "Required".
	const cleaned: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(raw)) {
		if (value !== "") cleaned[key] = value;
	}
	const result = schema.safeParse(cleaned);
	if (!result.success) {
		const issues = result.error.issues
			.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
			.join("; ");
		throw new Error(`Invalid environment configuration: ${issues}`);
	}
	const env = result.data;
	const warnings = OPTIONAL_INTEGRATIONS.filter((k) => !env[k]).map(
		(k) => `${k} is not set — the feature that depends on it is disabled.`,
	);
	return { env, warnings };
}
