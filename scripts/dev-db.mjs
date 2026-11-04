// Local development database: a real Postgres (PGlite) served over a socket, so the Next.js app
// can run end to end without a Neon project. Data persists in .data/pglite.
//
//   pnpm dev:db        start it (applies any new migrations first)
//   pnpm dev:db:reset  wipe it
//
// The app connects with DATABASE_URL=postgresql://postgres@127.0.0.1:5433/postgres and LOCAL_DEV_DB=1.
// PGlite sessions are superusers, so the app drops to the `procura_app` role per transaction and
// Row Level Security is enforced just as it is on Neon. Never use this in production.
import { mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = join(root, ".data", "pglite");
const migrations = join(root, "packages", "database", "migrations");
const port = Number(process.env.DEV_DB_PORT ?? 5433);

if (process.argv.includes("--reset")) {
  rmSync(dataDir, { recursive: true, force: true });
  console.log("Local database wiped.");
  process.exit(0);
}

mkdirSync(dataDir, { recursive: true });
const db = new PGlite(dataDir);
await db.waitReady;

await db.exec(`
  DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'procura_app') THEN CREATE ROLE procura_app NOLOGIN; END IF;
  END $$;
  CREATE TABLE IF NOT EXISTS _dev_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
`);

const applied = new Set((await db.query("SELECT name FROM _dev_migrations")).rows.map((r) => r.name));
for (const file of readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort()) {
  if (applied.has(file)) continue;
  const sql = readFileSync(join(migrations, file), "utf8");
  for (const stmt of sql.split("--> statement-breakpoint")) if (stmt.trim()) await db.exec(stmt);
  await db.query("INSERT INTO _dev_migrations(name) VALUES ($1)", [file]);
  console.log(`applied ${file}`);
}

// Tables created by later migrations still need the app role's privileges.
await db.exec(`
  GRANT USAGE ON SCHEMA public TO procura_app;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO procura_app;
  REVOKE UPDATE, DELETE ON audit_logs, agent_events FROM procura_app;
`);

const server = new PGLiteSocketServer({ db, port, host: "127.0.0.1", maxConnections: 4 });
await server.start();
console.log(`Local Postgres ready on 127.0.0.1:${port}`);
console.log(`DATABASE_URL=postgresql://postgres@127.0.0.1:${port}/postgres  (with LOCAL_DEV_DB=1)`);

const stop = async () => { await server.stop(); await db.close(); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
