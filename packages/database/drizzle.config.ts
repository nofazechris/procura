import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: "../../.env" });

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./migrations",
  dbCredentials: {
    // Migrations run as the schema owner over a direct (unpooled) Neon connection.
    // The running app connects as a separate non-owner role so Row Level Security applies.
    url: process.env.MIGRATION_DATABASE_URL ?? "postgres://placeholder/for-generate-only",
  },
  strict: true,
  verbose: true,
});
