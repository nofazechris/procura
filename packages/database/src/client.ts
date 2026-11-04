import { neonConfig, Pool as NeonPool } from "@neondatabase/serverless";
import { sql } from "drizzle-orm";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { Pool as PgPool } from "pg";
import ws from "ws";
import * as schema from "./schema";

/**
 * Any Postgres Drizzle database or transaction. Services accept this and never import a concrete
 * driver, so production (Neon), local development (node-postgres) and tests (PGlite) all work.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DbLike = PgDatabase<any, typeof schema>;
export type Db = DbLike;
export type Tx = DbLike;

declare global {
  // eslint-disable-next-line no-var
  var __procuraDb: Db | undefined;
}

/** True when running against the local development database (see scripts/dev-db.mjs). */
export function isLocalDevDb(): boolean {
  return process.env.LOCAL_DEV_DB === "1";
}

/**
 * Production: Neon over WebSockets, so we get real interactive transactions. The HTTP driver
 * cannot hold a transaction open, and tenant isolation depends on one (see withTenant).
 * DATABASE_URL must be the Neon *pooled* string for the non-owner `procura_app` role, which is
 * subject to Row Level Security. Never use the owner role here.
 *
 * Local development (LOCAL_DEV_DB=1): a plain node-postgres connection to the PGlite server that
 * `pnpm dev:db` starts. Never enabled in production.
 */
export function getDb(): Db {
  if (globalThis.__procuraDb) return globalThis.__procuraDb;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  let db: Db;
  if (isLocalDevDb()) {
    if (process.env.NODE_ENV === "production") throw new Error("LOCAL_DEV_DB must not be enabled in production");
    // PGlite serves one connection at a time.
    db = drizzlePg({ client: new PgPool({ connectionString: url, max: 1 }), schema });
  } else {
    neonConfig.webSocketConstructor = ws;
    db = drizzleNeon({ client: new NeonPool({ connectionString: url }), schema });
  }
  globalThis.__procuraDb = db;
  return db;
}

export interface TenantContext {
  userId: string;
  /** Omit only for queries that resolve which businesses the user belongs to. */
  businessId?: string;
}

/**
 * Run `fn` inside a transaction with the tenant context set. Row Level Security policies read
 * these settings, so a query that forgets a `business_id` filter still cannot cross tenants.
 * `set_config(..., true)` scopes the value to this transaction only, so it cannot leak across
 * pooled connections.
 */
export async function withTenant<T>(ctx: TenantContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return getDb().transaction(async (tx) => {
    // PGlite connects as a superuser, which bypasses RLS. Drop to the app role for this
    // transaction so local development enforces the same isolation as production.
    if (isLocalDevDb()) await tx.execute(sql`set local role procura_app`);
    await tx.execute(
      sql`select set_config('app.current_user_id', ${ctx.userId}, true),
                 set_config('app.current_business_id', ${ctx.businessId ?? ""}, true)`,
    );
    return fn(tx);
  });
}
