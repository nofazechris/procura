import { and, eq, inArray, sql } from "drizzle-orm";
import {
  procurementItems, procurementRequests, quotations, recordAudit, supplierEvidence,
  supplierPayoutDestinations, suppliers, type DbLike,
} from "@procura/database";
import {
  add, assertRequestTransition, money, multiply, ServiceError, sum, type RequestStatus,
} from "@procura/shared";
import type { SupplierProvider } from "../providers/types";
import type { ServiceContext } from "./context";

const DAY = 24 * 60 * 60 * 1000;

export interface SourcingSummary {
  suppliersFound: number;
  quotationsCreated: number;
  quotationsSkipped: number;
  requestStatus: RequestStatus;
}

/**
 * Discover suppliers and collect quotations through a provider, then move the request to
 * "comparing". Until the Phase 7 worker exists this stands in for the orchestrator's discovery
 * and quotation stages, using the same persistence the worker will use.
 *
 * Safe to re-run: suppliers are upserted by (business, source, external ref) and a quotation
 * already stored for the same supplier reference is not duplicated.
 */
export async function runSourcing(
  tx: DbLike, ctx: ServiceContext, requestId: string, provider: SupplierProvider,
): Promise<SourcingSummary> {
  const [request] = await tx.select().from(procurementRequests)
    .where(and(eq(procurementRequests.id, requestId), eq(procurementRequests.businessId, ctx.businessId)));
  if (!request) throw new ServiceError("NOT_FOUND", "Procurement request not found.", 404);

  const items = await tx.select().from(procurementItems).where(eq(procurementItems.requestId, requestId));
  if (items.length === 0) throw new ServiceError("NO_ITEMS", "The request has no items to source.", 422);

  // Walk the request through the legal stages so the state machine is honoured, not bypassed.
  const path: RequestStatus[] = ["draft", "submitted", "analysing", "sourcing", "comparing"];
  const start = path.indexOf(request.status);
  if (start === -1) {
    throw new ServiceError("INVALID_STATE", `A request that is ${request.status} cannot be sourced.`, 409);
  }
  for (let i = start; i < path.length - 1; i++) assertRequestTransition(path[i]!, path[i + 1]!);

  const found = await provider.searchSuppliers({
    items: items.map((i) => ({ name: i.productName, quantity: i.quantity })),
    ...(request.deliveryLocation ? { location: request.deliveryLocation } : {}),
  });

  let quotationsCreated = 0;
  let quotationsSkipped = 0;

  for (const r of found) {
    const [supplier] = await tx.insert(suppliers).values({
      businessId: ctx.businessId, name: r.name, legalName: r.legalName ?? null, description: r.description ?? null,
      countryCode: r.countryCode ?? null, city: r.city ?? null, email: r.email ?? null, phone: r.phone ?? null,
      categories: r.categories, sourceType: r.sourceType, externalRef: r.externalRef,
    }).onConflictDoUpdate({
      target: [suppliers.businessId, suppliers.sourceType, suppliers.externalRef],
      targetWhere: sql`${suppliers.externalRef} is not null`,
      set: { name: r.name, legalName: r.legalName ?? null, description: r.description ?? null, categories: r.categories },
    }).returning();
    if (!supplier) throw new Error("Supplier upsert returned no row");

    // Refresh this provider's evidence for the supplier. Evidence from other sources is untouched.
    const sourceNames = [...new Set(r.evidence.map((e) => e.sourceName))];
    if (sourceNames.length > 0) {
      await tx.delete(supplierEvidence).where(and(
        eq(supplierEvidence.supplierId, supplier.id), inArray(supplierEvidence.sourceName, sourceNames),
      ));
    }
    if (r.evidence.length > 0) {
      await tx.insert(supplierEvidence).values(r.evidence.map((e) => ({
        businessId: ctx.businessId, supplierId: supplier.id, evidenceType: e.evidenceType,
        sourceUrl: e.sourceUrl ?? null, sourceName: e.sourceName, evidenceData: e.data ?? {},
        verificationStatus: e.verificationStatus, collectedAt: ctx.now,
        expiresAt: e.validForDays ? new Date(ctx.now.getTime() + e.validForDays * DAY) : null,
      })));
    }

    // A payout destination is only ever PROPOSED here. A person approves it; the agent cannot.
    if (r.payoutDestination) {
      await tx.insert(supplierPayoutDestinations).values({
        businessId: ctx.businessId, supplierId: supplier.id, address: r.payoutDestination.address,
        network: r.payoutDestination.network, asset: r.payoutDestination.asset, status: "pending",
      }).onConflictDoNothing();
    }

    const quotes = provider.getQuotations
      ? await provider.getQuotations(r.externalRef, {
          currency: request.currency,
          items: items.map((i) => ({ name: i.productName, quantity: i.quantity })),
        })
      : [];

    for (const q of quotes) {
      const existing = await tx.select({ id: quotations.id }).from(quotations).where(and(
        eq(quotations.requestId, requestId), eq(quotations.supplierId, supplier.id),
        eq(quotations.supplierQuoteReference, q.supplierQuoteReference),
      ));
      if (existing.length > 0) { quotationsSkipped++; continue; }

      const subtotal = sum(
        q.lines.map((l) => ({ amount: multiplyLine(l.unitPrice, l.quantity, q.currency), currency: q.currency })), q.currency,
      );
      const delivery = money(q.deliveryCost, q.currency);
      const additional = money(q.additionalCosts, q.currency);
      await tx.insert(quotations).values({
        businessId: ctx.businessId, requestId, supplierId: supplier.id,
        supplierQuoteReference: q.supplierQuoteReference,
        subtotal: subtotal.amount, deliveryCost: delivery.amount, additionalCosts: additional.amount,
        totalCost: add(add(subtotal, delivery), additional).amount, currency: q.currency,
        lineItems: q.lines, unknownCosts: q.unknownCosts, estimatedDeliveryDays: q.estimatedDeliveryDays,
        availabilityStatus: q.availability, quoteStatus: "received", sourceType: q.sourceType,
        sourceEvidence: { reference: q.sourceReference }, validUntil: new Date(ctx.now.getTime() + q.validForDays * DAY),
      });
      quotationsCreated++;
    }
  }

  await tx.update(procurementRequests).set({ status: "comparing" }).where(eq(procurementRequests.id, requestId));
  await recordAudit(tx, {
    businessId: ctx.businessId, actorType: "system", actorId: provider.name, action: "procurement.sourced",
    resourceType: "procurement_request", resourceId: requestId,
    previousState: { status: request.status }, newState: { status: "comparing" },
    metadata: { provider: provider.name, suppliersFound: found.length, quotationsCreated, quotationsSkipped, requestedBy: ctx.userId },
  });

  return { suppliersFound: found.length, quotationsCreated, quotationsSkipped, requestStatus: "comparing" };
}

function multiplyLine(unitPrice: string, quantity: string, currency: string): string {
  return multiply(money(unitPrice, currency), quantity).amount;
}
