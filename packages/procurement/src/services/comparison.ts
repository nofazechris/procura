import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  procurementItems, procurementRequests, quotations, spendingPolicies, supplierEvidence, suppliers, type DbLike,
} from "@procura/database";
import { decimalString, ServiceError, type SupplierEvidenceSummary } from "@procura/shared";
import { compareQuotations, type ComparisonView } from "../comparison";
import { evaluateEligibility } from "../eligibility";
import { summariseEvidence } from "../evidence";
import type { Priority, Quote, Requirement, SupplierContext } from "../types";
import type { ServiceContext } from "./context";

const DAY = 24 * 60 * 60 * 1000;

/** Supplier-provided, therefore untrusted: validated every time it is read. */
const LinesSchema = z.array(z.object({
  description: z.string().min(1), quantity: decimalString, unitPrice: decimalString,
}));

type QuoteRow = typeof quotations.$inferSelect;

export function rowToQuote(row: QuoteRow): Quote {
  const parsed = LinesSchema.safeParse(row.lineItems);
  return {
    id: row.id, supplierId: row.supplierId, currency: row.currency,
    // A malformed line list yields no lines, so the quote fails the "all items priced" check.
    lines: parsed.success ? parsed.data : [],
    subtotal: row.subtotal, deliveryCost: row.deliveryCost, additionalCosts: row.additionalCosts,
    totalCost: row.totalCost, unknownCosts: row.unknownCosts,
    estimatedDeliveryDays: row.estimatedDeliveryDays,
    availability: row.availabilityStatus, status: row.quoteStatus, validUntil: row.validUntil,
  };
}

export interface LoadedRequest {
  request: typeof procurementRequests.$inferSelect;
  requirement: Requirement;
  itemRows: (typeof procurementItems.$inferSelect)[];
}

export async function loadRequirement(tx: DbLike, ctx: ServiceContext, requestId: string): Promise<LoadedRequest> {
  const [request] = await tx.select().from(procurementRequests)
    .where(and(eq(procurementRequests.id, requestId), eq(procurementRequests.businessId, ctx.businessId)));
  if (!request) throw new ServiceError("NOT_FOUND", "Procurement request not found.", 404);
  const itemRows = await tx.select().from(procurementItems).where(eq(procurementItems.requestId, requestId));

  const maxDeliveryDays = request.deliveryDeadline
    ? Math.max(0, Math.ceil((request.deliveryDeadline.getTime() - ctx.now.getTime()) / DAY))
    : null;
  return {
    request, itemRows,
    requirement: {
      currency: request.currency, budget: request.budgetAmount, maxDeliveryDays,
      items: itemRows.map((i) => ({ id: i.id, name: i.productName, quantity: i.quantity })),
    },
  };
}

/** Deterministic comparison of every stored quote for a request. No model involved. */
export async function loadComparison(tx: DbLike, ctx: ServiceContext, requestId: string): Promise<ComparisonView> {
  const { request, requirement } = await loadRequirement(tx, ctx, requestId);
  const quoteRows = await tx.select().from(quotations)
    .where(and(eq(quotations.requestId, requestId), eq(quotations.businessId, ctx.businessId)));

  const supplierIds = [...new Set(quoteRows.map((q) => q.supplierId))];
  const supplierRows = supplierIds.length
    ? await tx.select().from(suppliers).where(inArray(suppliers.id, supplierIds)) : [];
  const evidenceRows = supplierIds.length
    ? await tx.select().from(supplierEvidence).where(inArray(supplierEvidence.supplierId, supplierIds)) : [];
  const [policy] = await tx.select().from(spendingPolicies).where(eq(spendingPolicies.businessId, ctx.businessId));

  const restricted = new Set(policy?.restrictedSupplierIds ?? []);
  const evidenceBySupplier = new Map<string, SupplierEvidenceSummary>();
  for (const id of supplierIds) {
    evidenceBySupplier.set(id, summariseEvidence(
      evidenceRows.filter((e) => e.supplierId === id).map((e) => ({
        evidenceType: e.evidenceType, verificationStatus: e.verificationStatus, expiresAt: e.expiresAt,
      })),
      ctx.now,
    ));
  }

  const quotes = quoteRows.map(rowToQuote);
  const eligibilities = quotes.map((q) => {
    const supplier: SupplierContext = {
      supplierId: q.supplierId, restricted: restricted.has(q.supplierId),
      evidence: evidenceBySupplier.get(q.supplierId)!,
    };
    return evaluateEligibility(q, requirement, supplier, ctx.now);
  });

  const comparison = compareQuotations({
    currency: requirement.currency, quotes, eligibilities, evidenceBySupplier,
    priorities: [request.priority as Priority],
  });

  return {
    comparison,
    suppliers: supplierRows.map((s) => ({ id: s.id, name: s.name, sourceType: s.sourceType })),
    evidence: Object.fromEntries(evidenceBySupplier),
  };
}
