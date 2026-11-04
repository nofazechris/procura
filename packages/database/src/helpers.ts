import { sql } from "drizzle-orm";
import type { DbLike } from "./client";
import { auditLogs, documentCounters } from "./schema";

export interface AuditEntry {
  businessId: string;
  actorType: "user" | "agent" | "system" | "worker";
  actorId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  previousState?: Record<string, unknown> | null;
  newState?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
}

/** Write an audit record inside the caller's transaction so the audit and the change commit together. */
export async function recordAudit(tx: DbLike, entry: AuditEntry): Promise<void> {
  await tx.insert(auditLogs).values({
    businessId: entry.businessId,
    actorType: entry.actorType,
    actorId: entry.actorId ?? null,
    action: entry.action,
    resourceType: entry.resourceType,
    resourceId: entry.resourceId ?? null,
    previousState: entry.previousState ?? null,
    newState: entry.newState ?? null,
    metadata: entry.metadata ?? {},
  });
}

const PREFIX = { procurement_request: "PR", purchase_order: "PO" } as const;

/** Race-free sequential numbers: the upsert takes a row lock, so concurrent callers get distinct values. */
export async function nextDocumentNumber(
  tx: DbLike,
  businessId: string,
  kind: keyof typeof PREFIX,
): Promise<string> {
  const [row] = await tx
    .insert(documentCounters)
    .values({ businessId, kind, lastValue: 1 })
    .onConflictDoUpdate({
      target: [documentCounters.businessId, documentCounters.kind],
      set: { lastValue: sql`${documentCounters.lastValue} + 1` },
    })
    .returning({ lastValue: documentCounters.lastValue });
  if (!row) throw new Error("Failed to allocate document number");
  return `${PREFIX[kind]}-${String(row.lastValue).padStart(4, "0")}`;
}

export function slugify(name: string): string {
  const base = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return base.slice(0, 48) || "business";
}
