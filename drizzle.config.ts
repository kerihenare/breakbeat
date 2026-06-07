import { defineConfig } from "drizzle-kit";

export default defineConfig({
	dbCredentials: {
		url:
			process.env.DATABASE_URL ??
			"postgres://breakbeat:breakbeat@localhost:5432/breakbeat",
	},
	dialect: "postgresql",
	out: "./migrations",
	schema: "./src/shared/database/schema.ts",
});
