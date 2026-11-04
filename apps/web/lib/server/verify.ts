import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { recordAudit, spendingSessions, supplierEvidence, suppliers, withTenant, type Tx } from "@procura/database";
import {
  buildCall, costExceeds, estimateCost, isVerifyUrl, parseOutcome, plannedChecks, summariseEvidence, VERIFY_CHECKS, VERIFY_VALID_DAYS,
  type CheckOutcome, type PlannedCheck, type SupplierFacts, type VerifyCheckId,
} from "@procura/procurement";
import { ServiceError } from "@procura/shared";
import type { TenantAccess } from "../guard";
import { paidCall, type PaidFailure } from "./passport";

/** The same payment on the same day gets the same key, so a double click or a retry is never charged twice. */
export function paymentKey(supplierId: string, check: VerifyCheckId, url: string, body: unknown, now: Date): string {
  const h = createHash("sha256").update(JSON.stringify([supplierId, check, url, body ?? null, now.toISOString().slice(0, 10)])).digest();
  h[6] = (h[6]! & 0x0f) | 0x50; h[8] = (h[8]! & 0x3f) | 0x80; // a well-formed UUID
  const x = h.subarray(0, 16).toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

export const factsOf = (s: { name: string; legalName: string | null; countryCode: string | null; email: string | null }): SupplierFacts =>
  ({ name: s.name, legalName: s.legalName, countryCode: s.countryCode, email: s.email });

export interface CheckReport {
  check: VerifyCheckId; label: string;
  state: "done" | "error" | "skipped";
  outcome?: CheckOutcome; charged?: string | null;
  error?: { kind: PaidFailure | "not_ready"; message: string };
}

export interface VerifyRun {
  reports: CheckReport[];
  /** True when a problem with money or the session stopped the remaining checks. */
  stopped: boolean;
  evidenceSummary: ReturnType<typeof summariseEvidence>;
}

/** A problem with the wallet or the session would hit every later check the same way, so it stops the run. */
const STOPS: ReadonlySet<string> = new Set<PaidFailure>(["wallet_empty", "session_limit", "session_unusable", "not_signed_in", "pending", "not_settled", "failed"]);

/** A supplier that can be verified: it exists in this business and is a real, directly paid one. */
export async function loadVerifiable(tx: Tx, access: TenantAccess, supplierId: string) {
  const [supplier] = await tx.select().from(suppliers).where(and(eq(suppliers.id, supplierId), eq(suppliers.businessId, access.businessId)));
  if (!supplier) return null;
  if (supplier.sourceType === "demo") throw new ServiceError("SUPPLIER_NOT_VERIFIABLE", "This is a fictional demo supplier. There is nothing real to verify.", 422);
  if (supplier.sourceType === "marketplace") {
    throw new ServiceError("SUPPLIER_NOT_VERIFIABLE", "A marketplace seller is paid through the marketplace checkout, so there is no supplier to verify.", 422);
  }
  return supplier;
}

const tenant = (access: TenantAccess) => ({ userId: access.userId, businessId: access.businessId });

export async function runVerification(
  access: TenantAccess, supplierId: string, input: { checks: VerifyCheckId[]; sessionId: string; maxCost: string },
): Promise<VerifyRun> {
  const { supplier, session } = await withTenant(tenant(access), async (tx) => {
    const found = await loadVerifiable(tx, access, supplierId);
    if (!found) throw new ServiceError("NOT_FOUND", "Supplier not found.", 404);
    const [s] = await tx.select().from(spendingSessions)
      .where(and(eq(spendingSessions.id, input.sessionId), eq(spendingSessions.businessId, access.businessId)));
    return { supplier: found, session: s ?? null };
  });

  const now = new Date();
  const facts = factsOf(supplier);
  const plan: PlannedCheck[] = plannedChecks(facts, input.checks);
  const ready = plan.filter((p) => p.ready);
  if (ready.length === 0) {
    throw new ServiceError("NOTHING_TO_CHECK", `Add ${plan.map((p) => p.missing).filter(Boolean).join(" and ")} to this supplier first.`, 422);
  }
  const estimate = estimateCost(plan);
  // The person agreed to a price. If the checks now cost more than that, ask again rather than spend.
  if (costExceeds(estimate, input.maxCost)) {
    throw new ServiceError("PRICE_CHANGED", "The cost of these checks changed. Review the new total and confirm again.", 409, { estimate });
  }

  if (!session) throw new ServiceError("SESSION_NOT_FOUND", "Choose one of this business's spending sessions.", 404);
  if (session.status !== "active" || !session.passportSessionReference) {
    throw new ServiceError("SESSION_NOT_ACTIVE", "That spending session is not approved and active.", 409);
  }
  if (session.expiresAt && session.expiresAt.getTime() <= now.getTime()) {
    throw new ServiceError("SESSION_EXPIRED", "That spending session has expired. Ask for a new one.", 409);
  }
  const mostExpensive = ready.reduce((m, p) => (costExceeds(p.price, m) ? p.price : m), "0");
  if (costExceeds(mostExpensive, session.maxAmountPerTransaction) || costExceeds(estimate, session.maxTotalAmount)) {
    throw new ServiceError("SESSION_TOO_SMALL", "That session's limits are smaller than these checks cost. Ask for a session that covers them.", 409);
  }

  const reports: CheckReport[] = [];
  let stopped = false;

  for (const p of plan) {
    const spec = VERIFY_CHECKS[p.id];
    if (!p.ready) { reports.push({ check: p.id, label: spec.label, state: "skipped", error: { kind: "not_ready", message: `Needs ${p.missing}.` } }); continue; }
    if (stopped) { reports.push({ check: p.id, label: spec.label, state: "skipped", error: { kind: "not_ready", message: "Not run, because an earlier check stopped." } }); continue; }

    const call = buildCall(p.id, facts);
    if (!isVerifyUrl(call.url)) throw new ServiceError("INTERNAL", "Refused to call an unexpected address.", 500);
    const key = paymentKey(supplierId, p.id, call.url, call.body, now);
    const result = await paidCall({
      url: call.url, method: call.method, ...(call.body ? { body: call.body } : {}),
      sessionId: session.passportSessionReference, idempotencyKey: key,
    });

    if (!result.ok) {
      reports.push({ check: p.id, label: spec.label, state: "error", error: { kind: result.kind, message: result.message } });
      await audit(access, supplierId, "supplier.verification_failed", { check: p.id, kind: result.kind, code: result.code, sessionId: session.id });
      if (STOPS.has(result.kind)) stopped = true;
      continue;
    }

    const outcome = parseOutcome(p.id, result.body, facts);
    await saveEvidence(access, supplierId, p.id, outcome, session.id, result.amount, key, now);
    reports.push({ check: p.id, label: spec.label, state: "done", outcome, charged: result.amount ?? spec.price });
  }

  return { reports, stopped, evidenceSummary: await readSummary(access, supplierId) };
}

function audit(access: TenantAccess, supplierId: string, action: string, newState: Record<string, unknown>) {
  return withTenant(tenant(access), (tx) =>
    recordAudit(tx, { businessId: access.businessId, actorType: "user", actorId: access.userId, action, resourceType: "supplier", resourceId: supplierId, newState }));
}

/** Replaces this check's earlier evidence with the new answer and records the spend, in one transaction. */
async function saveEvidence(
  access: TenantAccess, supplierId: string, check: VerifyCheckId, outcome: CheckOutcome,
  sessionId: string, charged: string | null, key: string, now: Date,
) {
  const spec = VERIFY_CHECKS[check];
  await withTenant(tenant(access), async (tx) => {
    await tx.delete(supplierEvidence).where(and(
      eq(supplierEvidence.supplierId, supplierId), eq(supplierEvidence.evidenceType, spec.evidenceType), eq(supplierEvidence.sourceName, spec.sourceName),
    ));
    await tx.insert(supplierEvidence).values({
      businessId: access.businessId, supplierId, evidenceType: spec.evidenceType, sourceName: spec.sourceName,
      evidenceData: { summary: outcome.summary, check, ...outcome.data }, verificationStatus: outcome.status, collectedAt: now,
      expiresAt: new Date(now.getTime() + VERIFY_VALID_DAYS * 86_400_000),
    });
    await recordAudit(tx, {
      businessId: access.businessId, actorType: "user", actorId: access.userId, action: "supplier.verification_check",
      resourceType: "supplier", resourceId: supplierId,
      newState: { check, status: outcome.status, charged: charged ?? spec.price, currency: "USD", sessionId, idempotencyKey: key },
    });
  });
}

/** Re-reads the evidence and keeps the supplier's own status in step with it. */
export function readSummary(access: TenantAccess, supplierId: string) {
  return withTenant(tenant(access), async (tx) => {
    const rows = await tx.select().from(supplierEvidence).where(eq(supplierEvidence.supplierId, supplierId));
    const summary = summariseEvidence(rows.map((e) => ({ evidenceType: e.evidenceType, verificationStatus: e.verificationStatus, expiresAt: e.expiresAt })), new Date());
    const status = summary.identityVerified === false || summary.contactVerified === false ? "failed"
      : summary.identityVerified === true ? "verified" : "unverified";
    await tx.update(suppliers).set({ verificationStatus: status }).where(eq(suppliers.id, supplierId));
    return summary;
  });
}
