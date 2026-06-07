import { pgTable, text } from "drizzle-orm/pg-core";

// Baseline table: exists only to prove migrations apply end-to-end. The real
// jobs/results schema arrives in Slice 2 (aglow-ti2.2).
export const appMeta = pgTable("app_meta", {
	key: text("key").primaryKey(),
	value: text("value").notNull(),
});
