import { sql } from "drizzle-orm";
import { getDb } from "@procura/database";
import { fail, ok } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Liveness plus a database round trip. Reveals nothing about configuration. */
export async function GET() {
  try {
    await getDb().execute(sql`select 1`);
    return ok({ status: "ok", database: "up", time: new Date().toISOString() });
  } catch {
    return fail(503, "UNHEALTHY", "Database is unreachable.");
  }
}
