import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS = join(__dirname, "../../packages/database/migrations");

/** A fresh in-process Postgres with every real migration applied and the app role created. */
export async function migratedPglite(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`CREATE ROLE procura_app NOLOGIN`);
  for (const f of readdirSync(MIGRATIONS).filter((n) => n.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(MIGRATIONS, f), "utf8");
    for (const stmt of sql.split("--> statement-breakpoint")) {
      if (stmt.trim()) await db.exec(stmt);
    }
  }
  return db;
}
