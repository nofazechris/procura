import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { auditLogs, recordAudit, spendingSessions, suppliers, withTenant } from "@procura/database";
import {
  buildCallBody, CALL_PRICE, CALL_STATUS_URL, CALL_URL, costExceeds, isCallUrl, parseCallStarted, parseCallStatus, phoneHint, toE164,
  type CallScriptParts, type CallStatus,
} from "@procura/procurement";
import { ServiceError } from "@procura/shared";
import type { TenantAccess } from "../guard";
import { sanitiseCallScript } from "./agent";
import { paidCall } from "./passport";

/**
 * Places a real phone call to a seller through StablePhone, paid per call from an approved Kite
 * Passport session. This contacts a real person, so it runs only after the person read the script and
 * confirmed, only to the number saved on the seller, and only with the AI saying it is an AI.
 */

const tenant = (a: TenantAccess) => ({ userId: a.userId, businessId: a.businessId });

/** The same call to the same number within the hour is the same call, so a double click cannot ring twice. */
function callKey(supplierId: string, phone: string, task: unknown, now: Date): string {
  const h = createHash("sha256").update(JSON.stringify([supplierId, phone, task, now.toISOString().slice(0, 13)])).digest();
  h[6] = (h[6]! & 0x0f) | 0x50; h[8] = (h[8]! & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

async function loadCallable(access: TenantAccess, supplierId: string) {
  return withTenant(tenant(access), async (tx) => {
    const [s] = await tx.select().from(suppliers).where(and(eq(suppliers.id, supplierId), eq(suppliers.businessId, access.businessId)));
    if (!s) throw new ServiceError("NOT_FOUND", "Seller not found.", 404);
    if (s.sourceType === "demo") throw new ServiceError("SELLER_NOT_CALLABLE", "This is a fictional demo seller. There is no one to call.", 422);
    if (s.sourceType === "marketplace") throw new ServiceError("SELLER_NOT_CALLABLE", "Marketplace sellers are bought from at checkout. They are not called.", 422);
    return s;
  });
}

async function loadSession(access: TenantAccess, sessionId: string) {
  const [s] = await withTenant(tenant(access), (tx) =>
    tx.select().from(spendingSessions).where(and(eq(spendingSessions.id, sessionId), eq(spendingSessions.businessId, access.businessId))));
  if (!s) throw new ServiceError("SESSION_NOT_FOUND", "Choose one of your spending sessions.", 404);
  if (s.status !== "active" || !s.passportSessionReference) throw new ServiceError("SESSION_NOT_ACTIVE", "That spending session is not approved and active.", 409);
  if (s.expiresAt && s.expiresAt.getTime() <= Date.now()) throw new ServiceError("SESSION_EXPIRED", "That spending session has expired. Ask for a new one.", 409);
  return s;
}

export interface PlacedCall { callId: string; phone: string; price: string }

export async function placeSellerCall(access: TenantAccess, supplierId: string, input: { sessionId: string; script: CallScriptParts; confirmed: boolean }): Promise<PlacedCall> {
  if (!input.confirmed) throw new ServiceError("NOT_CONFIRMED", "Confirm the call first. Nobody was called.", 422);
  const seller = await loadCallable(access, supplierId);
  const phone = toE164(seller.phone);
  if (!phone) throw new ServiceError("PHONE_MISSING", "Save this seller's phone number in international format, such as +2348012345678, before calling.", 422);
  const session = await loadSession(access, input.sessionId);
  if (costExceeds(CALL_PRICE, session.maxAmountPerTransaction) || costExceeds(CALL_PRICE, session.maxTotalAmount)) {
    throw new ServiceError("SESSION_TOO_SMALL", `That session is smaller than the $${CALL_PRICE} a call costs.`, 409);
  }

  // The script is what the person read. It is cleaned again here, so nothing that promises payment can reach the phone.
  const clean = sanitiseCallScript({ opening: input.script.opening, questions: input.script.questions, mustConfirm: input.script.mustConfirm, closing: input.script.closing });
  const body = buildCallBody(phone, seller.legalName ?? seller.name, clean);
  if (!isCallUrl(CALL_URL)) throw new ServiceError("INTERNAL", "Refused to call an unexpected address.", 500);

  const result = await paidCall({ url: CALL_URL, method: "POST", body, sessionId: session.passportSessionReference!, idempotencyKey: callKey(supplierId, phone, body["task"], new Date()) });
  if (!result.ok) {
    await audit(access, supplierId, "supplier.call_failed", { kind: result.kind, code: result.code, phone: phoneHint(phone) });
    const dnc = result.kind === "service_error" && /\(403\)/.test(result.message);
    throw new ServiceError("CALL_NOT_PLACED", dnc ? "The calling service refused this number (it may be on a Do-Not-Call list). Nobody was called and nothing was charged." : result.message, 502, { kind: result.kind });
  }
  const started = parseCallStarted(result.body);
  if (!started) {
    await audit(access, supplierId, "supplier.call_failed", { kind: "unreadable", phone: phoneHint(phone), charged: result.amount });
    throw new ServiceError("CALL_UNCLEAR", "The calling service answered in a form Procura could not read, so it cannot say whether the call started. Check your Spending page before trying again.", 502);
  }
  await audit(access, supplierId, "supplier.call_placed", { callId: started.callId, phone: phoneHint(phone), charged: result.amount ?? CALL_PRICE, sessionId: session.id });
  return { callId: started.callId, phone: phoneHint(phone), price: result.amount ?? CALL_PRICE };
}

export interface CallRecord { callId: string; at: string; phone: string }

/** The calls made to this seller, newest first, from the audit trail. */
export async function listCalls(access: TenantAccess, supplierId: string): Promise<CallRecord[]> {
  const rows = await withTenant(tenant(access), (tx) =>
    tx.select().from(auditLogs).where(and(eq(auditLogs.businessId, access.businessId), eq(auditLogs.resourceId, supplierId), eq(auditLogs.action, "supplier.call_placed"))).orderBy(desc(auditLogs.createdAt)).limit(10));
  return rows.flatMap((r) => {
    const s = r.newState ?? {};
    return typeof s["callId"] === "string" ? [{ callId: s["callId"], at: r.createdAt.toISOString(), phone: typeof s["phone"] === "string" ? s["phone"] : "" }] : [];
  });
}

/** Where a call stands. Free to read, and only for a call this business placed to this seller. */
export async function readCallStatus(access: TenantAccess, supplierId: string, callId: string, sessionId: string): Promise<CallStatus | null> {
  if (!(await listCalls(access, supplierId)).some((c) => c.callId === callId)) throw new ServiceError("NOT_FOUND", "Call not found.", 404);
  const session = await loadSession(access, sessionId);
  const url = CALL_STATUS_URL(callId);
  if (!isCallUrl(url)) throw new ServiceError("INTERNAL", "Refused to read an unexpected address.", 500);
  const r = await paidCall({ url, method: "GET", sessionId: session.passportSessionReference!, idempotencyKey: callKey(supplierId, callId, "status", new Date()) });
  return r.ok ? parseCallStatus(r.body) : null;
}

async function audit(access: TenantAccess, supplierId: string, action: string, newState: Record<string, unknown>) {
  await withTenant(tenant(access), (tx) =>
    recordAudit(tx, { businessId: access.businessId, actorType: "user", actorId: access.userId, action, resourceType: "supplier", resourceId: supplierId, newState }));
}
