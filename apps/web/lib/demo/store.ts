/**
 * Demo mode data (Design PRD s14-15). An in-memory store seeded with the fictional Northstar
 * Kitchen scenario. It runs the REAL eligibility, comparison and purchase-order engine from
 * @procura/procurement/core on sample data, so the demo shows true logic. Only persistence and
 * the Kite payment are simulated. Nothing here touches the network or a database.
 *
 * Everything is labelled demo in the UI and nothing is ever sent to a live service.
 */
import {
  buildPurchaseOrder, compareQuotations, DemoSupplierProvider, evaluateEligibility, summariseEvidence,
  type EvidenceRow, type Priority, type Quote,
} from "@procura/procurement/core";
import { add, money, multiply, PAYMENT_ASSET, PAYMENT_NETWORK, ServiceError, sum, type SupplierEvidenceSummary } from "@procura/shared";
import type {
  ActivityDTO, ApprovalDTO, BusinessDTO, BusinessSummaryDTO, ComparisonView, MemberDTO, OrderDetailDTO, OrderDTO,
  OrderItemDTO, PaymentDTO, PayoutDestinationDTO, PolicyDTO, QuotationDTO, RequestDetailDTO, RequestItemDTO, SourcingSummaryDTO,
  SupplierDetailDTO, SupplierDTO,
} from "../dto";

const DAY = 86_400_000;
const D6 = (v: string | number) => money(String(v), "USD").amount + "0000"; // "1630.00" -> "1630.000000"
const six = (v: string) => (v.includes(".") ? v.padEnd(v.indexOf(".") + 7, "0") : `${v}.000000`);

interface QuoteRow {
  id: string; requestId: string; supplierId: string; supplierQuoteReference: string; currency: string;
  lines: { description: string; quantity: string; unitPrice: string }[]; subtotal: string; deliveryCost: string;
  additionalCosts: string; totalCost: string; unknownCosts: string[]; estimatedDeliveryDays: number | null;
  availability: Quote["availability"]; status: Quote["status"]; validUntil: string | null; createdAt: string;
}

interface DemoEvidence { supplierId: string; row: EvidenceRow }

interface DemoState {
  requests: RequestDetailDTO[];
  suppliers: Omit<SupplierDTO, "evidenceSummary">[];
  evidence: DemoEvidence[];
  destinations: PayoutDestinationDTO[];
  quotes: QuoteRow[];
  orders: OrderDTO[];
  orderItems: Record<string, OrderItemDTO[]>;
  approvals: ApprovalDTO[];
  payments: PaymentDTO[];
  activity: ActivityDTO[];
  policy: PolicyDTO;
  business: BusinessDTO;
  members: MemberDTO[];
  counters: { request: number; order: number };
}

export const DEMO_USER = { userId: "demo-user", name: "Chris Godwin", email: "chris@northstar.demo" };
export const DEMO_BUSINESS: BusinessSummaryDTO = {
  id: "demo-business", name: "Northstar Kitchen", slug: "northstar-kitchen", defaultCurrency: "USD", role: "owner",
};

let current: DemoState | null = null;
let loading: Promise<DemoState> | null = null;

/** The demo store is built on first use, because the demo provider is asynchronous. */
export function getDemo(): Promise<DemoState> {
  if (current) return Promise.resolve(current);
  loading ??= seed().then((s) => (current = s));
  return loading;
}

/** Start from the original scenario again (used when the guided tour begins). */
export async function resetDemo(): Promise<void> {
  current = null;
  loading = null;
  await getDemo();
}

/* ------------------------------------------------------------------ */
/* Seed                                                                */
/* ------------------------------------------------------------------ */

async function seed(): Promise<DemoState> {
  const now = Date.now();
  const ago = (days: number, hours = 0) => new Date(now - days * DAY - hours * 3_600_000).toISOString();
  const monthsAgo = (m: number, day = 12) => { const d = new Date(now); d.setMonth(d.getMonth() - m); d.setDate(day); return d.toISOString(); };

  const s: DemoState = {
    requests: [], suppliers: [], evidence: [], destinations: [], quotes: [], orders: [], orderItems: {},
    approvals: [], payments: [], activity: [],
    policy: { id: "demo-policy", currency: "USD", maxTotalSpend: D6(20000), maxTransactionAmount: D6(2500), approvalRequired: true, approvalRequiredAbove: D6(500) },
    business: {
      id: "demo-business", name: "Northstar Kitchen", slug: "northstar-kitchen", industry: "Restaurant group", countryCode: "NG",
      defaultCurrency: "USD", website: "https://northstarkitchen.example", address: "14 Adeola Odeku St, Victoria Island, Lagos",
      preferences: { categories: ["Food & ingredients", "Packaging", "Beverages"], quality: "Balanced", delivery: "Balanced" },
    },
    members: [
      { id: "m1", userId: "demo-user", name: "Chris Godwin", email: "chris@northstar.demo", role: "owner", status: "active" },
      { id: "m2", userId: "u2", name: "Ada Nwosu", email: "ada@northstar.demo", role: "procurement_manager", status: "active" },
      { id: "m3", userId: "u3", name: "Tunde Afolabi", email: "tunde@northstar.demo", role: "finance_manager", status: "active" },
    ],
    counters: { request: 142, order: 2040 },
  };

  const addRequest = (
    n: number, title: string, status: RequestDetailDTO["status"], budget: number, by: string, created: string,
    items: Omit<RequestItemDTO, "id" | "requestId" | "specifications" | "description" | "preferredBrand">[],
  ) => {
    const id = `demo-req-${n}`;
    s.requests.push({
      id, businessId: DEMO_BUSINESS.id, requestNumber: `PR-${String(n).padStart(4, "0")}`, title, description: null, status,
      budgetAmount: D6(budget), currency: "USD", deliveryLocation: "Victoria Island, Lagos", deliveryDeadline: null, priority: "price",
      requestedBy: by === "Chris Godwin" ? "demo-user" : "u2", requestedByName: by, createdAt: created, updatedAt: created,
      items: items.map((it, i) => ({ ...it, id: `${id}-i${i}`, requestId: id, specifications: {}, description: null, preferredBrand: null })),
    });
  };

  addRequest(142, "Desk setup", "comparing", 120, "Chris Godwin", ago(0, 2), [
    { productName: "USB-C charger", category: "electronics", quantity: "2.000000", unit: "pieces" },
    { productName: "Desk lamp", category: "office", quantity: "1.000000", unit: "piece" },
    { productName: "Notebook", category: "stationery", quantity: "3.000000", unit: "packs" },
  ]);
  addRequest(141, "Packaging supplies", "awaiting_approval", 1000, "Ada Nwosu", ago(0, 5), [
    { productName: "Kraft boxes, medium", category: "packaging", quantity: "400.000000", unit: "units" },
    { productName: "Food containers", category: "packaging", quantity: "1000.000000", unit: "units" },
  ]);
  addRequest(140, "Cleaning and sanitation", "draft", 600, "Chris Godwin", ago(1), [
    { productName: "Sanitiser, 5L", category: "cleaning", quantity: "12.000000", unit: "cartons" },
  ]);
  addRequest(139, "Beverage restock", "sourcing", 1400, "Ada Nwosu", ago(2), [
    { productName: "Bottled water", category: "beverages", quantity: "60.000000", unit: "cases" },
  ]);
  addRequest(138, "Office equipment", "completed", 2500, "Chris Godwin", ago(6), [
    { productName: "Office desk, oak", category: "equipment", quantity: "4.000000", unit: "units" },
  ]);
  addRequest(137, "Uniform order", "completed", 750, "Ada Nwosu", ago(10), [
    { productName: "Chef jacket", category: "uniforms", quantity: "20.000000", unit: "units" },
  ]);
  addRequest(136, "Table linens", "cancelled", 420, "Ada Nwosu", ago(14), [
    { productName: "Table linen set", category: "linens", quantity: "30.000000", unit: "sets" },
  ]);

  // Sellers for the sample request come from the real demo provider.
  const provider = new DemoSupplierProvider();
  await runSourcingInto(s, "demo-req-142", provider, ago(0, 2));

  const extra = [
    { id: "demo-sup-rightway", name: "Rightway Packaging", city: "Lagos", categories: ["packaging"] },
    { id: "demo-sup-techpoint", name: "TechPoint Office", city: "Ikeja", categories: ["equipment", "office"] },
    { id: "demo-sup-uniforma", name: "Uniforma Ltd", city: "Ikoyi", categories: ["uniforms"] },
  ];
  for (const e of extra) {
    s.suppliers.push({
      id: e.id, name: e.name, legalName: `${e.name} (demo)`, description: "Fictional demo supplier.", countryCode: "NG", city: e.city,
      email: null, phone: null, website: null, categories: e.categories, verificationStatus: "unknown", sourceType: "demo", createdAt: ago(30),
    });
    for (const t of ["business_identity", "contact_information", "payment_destination", "delivery_history", "quotation"] as const) {
      s.evidence.push({ supplierId: e.id, row: { evidenceType: t, verificationStatus: "verified", expiresAt: null } });
    }
    s.destinations.push({
      id: `${e.id}-dest`, supplierId: e.id, address: `0xDe30000000000000000000000000000000${e.id.length.toString(16).padStart(6, "0")}`,
      network: PAYMENT_NETWORK, asset: PAYMENT_ASSET, status: "approved", approvedAt: ago(30),
    });
  }

  // History: completed and in-flight orders, plus older months so the spend chart has shape.
  const histOrder = (num: number, supplierId: string, supplierName: string, reqId: string, reqNum: string, reqTitle: string, total: number, status: OrderDTO["status"], created: string, lines: [string, string, string][]) => {
    const id = `demo-order-${num}`;
    s.orders.push({
      id, requestId: reqId, supplierId, quotationId: null, orderNumber: `PO-${num}`, subtotal: D6(total), deliveryCost: D6(0), totalAmount: D6(total),
      currency: "USD", paymentAsset: PAYMENT_ASSET, paymentAmount: D6(total), status, approvedFingerprint: status === "pending_approval" ? null : fakeHash(id),
      approvedAt: status === "pending_approval" ? null : created, createdAt: created, supplierName, supplierSource: "demo", requestNumber: reqNum, requestTitle: reqTitle,
    });
    s.orderItems[id] = lines.map(([d, q, p], i) => ({
      id: `${id}-l${i}`, description: d, quantity: six(q), unitPrice: six(p), totalPrice: multiply(money(p, "USD"), q).amount + "0000", currency: "USD",
    }));
  };
  histOrder(2039, "demo-sup-rightway", "Rightway Packaging", "demo-req-141", "PR-0141", "Packaging supplies", 880, "pending_approval", ago(0, 5),
    [["Kraft boxes, medium", "400", "1.20"], ["Food containers", "1000", "0.32"], ["Branded labels", "2000", "0.04"]]);
  histOrder(2035, "demo-sup-techpoint", "TechPoint Office", "demo-req-138", "PR-0138", "Office equipment", 2410, "fulfilled", ago(6),
    [["Office desk, oak", "4", "320.00"], ["Ergonomic chair", "6", "140.00"], ["Monitor, 27 inch", "2", "145.00"]]);
  histOrder(2031, "demo-sup-uniforma", "Uniforma Ltd", "demo-req-137", "PR-0137", "Uniform order", 750, "fulfilled", ago(10),
    [["Chef jacket", "20", "22.00"], ["Apron, branded", "40", "5.50"], ["Cap", "30", "3.00"]]);
  [9200, 11500, 10100, 13400, 12800].forEach((amt, i) => {
    const m = 5 - i;
    histOrder(1900 + i, "demo-sup-techpoint", "TechPoint Office", "demo-req-138", "PR-0138", "Monthly purchasing", amt, "fulfilled", monthsAgo(m), [["Monthly purchasing", "1", String(amt)]]);
  });

  // PO-2041 comes from the real engine against the real comparison.
  const cmp = comparisonFor(s, "demo-req-142");
  if (cmp.comparison.recommendedQuoteId) {
    createOrderInto(s, "demo-req-142", cmp.comparison.recommendedQuoteId, false, ago(0, 1));
  }

  // Approval rows for the seeded packaging order.
  s.approvals.push(approvalFor(s, "demo-order-2039", ago(0, 5)));

  const log = (action: string, resourceType: string, resourceId: string | null, hours: number, state: Record<string, unknown> | null, actor: "user" | "system" = "user") =>
    s.activity.push({
      id: `demo-act-${s.activity.length}`, actorType: actor, actorId: actor === "user" ? "demo-user" : "demo", actorName: actor === "user" ? "Chris Godwin" : null,
      action, resourceType, resourceId, newState: state, metadata: {}, createdAt: ago(0, hours),
    });
  log("procurement.created", "procurement_request", "demo-req-142", 2, { requestNumber: "PR-0142", itemCount: 3 });
  log("procurement.sourced", "procurement_request", "demo-req-142", 1.9, { status: "comparing" }, "system");
  log("order.created", "purchase_order", "demo-order-2041", 1, { orderNumber: "PO-2041" });
  log("procurement.created", "procurement_request", "demo-req-141", 5, { requestNumber: "PR-0141", itemCount: 2 });
  log("order.created", "purchase_order", "demo-order-2039", 4.5, { orderNumber: "PO-2039" });
  s.activity.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return s;
}

/* ------------------------------------------------------------------ */
/* Engine glue (the real logic, on demo data)                          */
/* ------------------------------------------------------------------ */

function toQuote(q: QuoteRow): Quote {
  return {
    id: q.id, supplierId: q.supplierId, currency: q.currency, lines: q.lines, subtotal: q.subtotal, deliveryCost: q.deliveryCost,
    additionalCosts: q.additionalCosts, totalCost: q.totalCost, unknownCosts: q.unknownCosts,
    estimatedDeliveryDays: q.estimatedDeliveryDays, availability: q.availability, status: q.status,
    validUntil: q.validUntil ? new Date(q.validUntil) : null,
  };
}

function evidenceFor(s: DemoState, supplierId: string): SupplierEvidenceSummary {
  return summariseEvidence(s.evidence.filter((e) => e.supplierId === supplierId).map((e) => e.row), new Date());
}

export function comparisonFor(s: DemoState, requestId: string): ComparisonView {
  const req = s.requests.find((r) => r.id === requestId);
  if (!req) throw new ServiceError("NOT_FOUND", "Procurement request not found.", 404);
  const requirement = {
    currency: req.currency, budget: req.budgetAmount, maxDeliveryDays: null as number | null,
    items: req.items.map((i) => ({ id: i.id, name: i.productName, quantity: i.quantity })),
  };
  const quotes = s.quotes.filter((q) => q.requestId === requestId).map(toQuote);
  const supplierIds = [...new Set(quotes.map((q) => q.supplierId))];
  const evidence = new Map<string, SupplierEvidenceSummary>(supplierIds.map((id) => [id, evidenceFor(s, id)]));
  const now = new Date();
  const eligibilities = quotes.map((q) =>
    evaluateEligibility(q, requirement, { supplierId: q.supplierId, restricted: false, evidence: evidence.get(q.supplierId)! }, now));
  const comparison = compareQuotations({
    currency: req.currency, quotes, eligibilities, evidenceBySupplier: evidence, priorities: [req.priority as Priority],
  });
  return {
    comparison,
    suppliers: supplierIds.map((id) => {
      const sup = s.suppliers.find((x) => x.id === id)!;
      return { id: sup.id, name: sup.name, sourceType: sup.sourceType };
    }),
    evidence: Object.fromEntries(evidence),
  };
}

async function runSourcingInto(s: DemoState, requestId: string, provider: DemoSupplierProvider, stamp: string): Promise<SourcingSummaryDTO> {
  const req = s.requests.find((r) => r.id === requestId)!;
  const found = await provider.searchSuppliers({ items: req.items.map((i) => ({ name: i.productName, quantity: i.quantity })) });
  let created = 0, skipped = 0;
  for (const r of found) {
    let sup = s.suppliers.find((x) => x.name === r.name);
    if (!sup) {
      sup = {
        id: `demo-sup-${r.externalRef.replace("demo-", "")}`, name: r.name, legalName: r.legalName ?? null, description: r.description ?? null,
        countryCode: r.countryCode ?? null, city: r.city ?? null, email: r.email ?? null, phone: r.phone ?? null, website: null,
        categories: r.categories, verificationStatus: "unknown", sourceType: "demo", createdAt: stamp,
      };
      s.suppliers.push(sup);
      for (const e of r.evidence) s.evidence.push({ supplierId: sup.id, row: { evidenceType: e.evidenceType, verificationStatus: e.verificationStatus, expiresAt: null } });
      if (r.payoutDestination) {
        // Proposed only. A person approves it.
        s.destinations.push({ id: `${sup.id}-dest`, supplierId: sup.id, address: r.payoutDestination.address, network: r.payoutDestination.network, asset: r.payoutDestination.asset, status: "pending", approvedAt: null });
      }
    }
    const quotes = await provider.getQuotations!(r.externalRef, { currency: req.currency, items: req.items.map((i) => ({ name: i.productName, quantity: i.quantity })) });
    for (const q of quotes) {
      if (s.quotes.some((x) => x.requestId === requestId && x.supplierId === sup!.id && x.supplierQuoteReference === q.supplierQuoteReference)) { skipped++; continue; }
      const subtotal = sum(q.lines.map((l) => multiply(money(l.unitPrice, q.currency), l.quantity)), q.currency);
      const delivery = money(q.deliveryCost, q.currency);
      const additional = money(q.additionalCosts, q.currency);
      s.quotes.push({
        id: `demo-quote-${s.quotes.length + 1}`, requestId, supplierId: sup.id, supplierQuoteReference: q.supplierQuoteReference, currency: q.currency,
        lines: q.lines.map((l) => ({ ...l, quantity: six(l.quantity), unitPrice: six(l.unitPrice) })),
        subtotal: six(subtotal.amount), deliveryCost: six(delivery.amount), additionalCosts: six(additional.amount),
        totalCost: six(add(add(subtotal, delivery), additional).amount), unknownCosts: q.unknownCosts, estimatedDeliveryDays: q.estimatedDeliveryDays,
        availability: q.availability, status: "received", validUntil: new Date(Date.now() + q.validForDays * DAY).toISOString(), createdAt: stamp,
      });
      created++;
    }
  }
  req.status = "comparing";
  return { suppliersFound: found.length, quotationsCreated: created, quotationsSkipped: skipped, requestStatus: "comparing" };
}

function createOrderInto(s: DemoState, requestId: string, quotationId: string, acknowledge: boolean, stamp: string): OrderDTO {
  const req = s.requests.find((r) => r.id === requestId)!;
  const q = s.quotes.find((x) => x.id === quotationId);
  if (!q) throw new ServiceError("NOT_FOUND", "Quotation not found for this request.", 404);
  if (s.orders.some((o) => o.requestId === requestId && o.status !== "cancelled" && o.status !== "failed")) {
    throw new ServiceError("ORDER_EXISTS", "This request already has an open purchase order.", 409);
  }
  const cmp = comparisonFor(s, requestId);
  const row = cmp.comparison.rows.find((r) => r.quoteId === quotationId)!;
  if (row.verdict === "ineligible") throw new ServiceError("QUOTE_INELIGIBLE", "This quotation does not meet the requirements.", 422, { reasons: row.eligibility.reasons });
  if (row.verdict === "review_required" && !acknowledge) {
    throw new ServiceError("REVIEW_REQUIRED", "This supplier has missing evidence. Confirm you reviewed it to continue.", 422, { reasons: row.eligibility.reasons, missingEvidence: row.eligibility.missingEvidence });
  }
  const now = new Date();
  let draft;
  try {
    draft = buildPurchaseOrder({
      supplierId: q.supplierId, quote: toQuote(q), items: req.items.map((i) => ({ id: i.id, name: i.productName, quantity: i.quantity })),
      currency: req.currency, budget: req.budgetAmount, paymentAsset: PAYMENT_ASSET,
      conversion: { rate: "1.000000", asOf: now, source: "fixed 1:1 demo peg (not a market rate)" }, now,
    });
  } catch (e) {
    if (e instanceof Error && e.name === "PurchaseOrderError") throw new ServiceError((e as Error & { code: string }).code, e.message, 422);
    throw e;
  }
  const sup = s.suppliers.find((x) => x.id === q.supplierId)!;
  const num = ++s.counters.order;
  const id = `demo-order-${num}`;
  const order: OrderDTO = {
    id, requestId, supplierId: sup.id, quotationId: q.id, orderNumber: `PO-${num}`, subtotal: six(draft.subtotal), deliveryCost: six(draft.deliveryCost),
    totalAmount: six(draft.totalAmount), currency: draft.currency, paymentAsset: draft.paymentAsset, paymentAmount: six(draft.paymentAmount),
    status: "pending_approval", approvedFingerprint: null, approvedAt: null, createdAt: stamp, supplierName: sup.name, supplierSource: "demo",
    requestNumber: req.requestNumber, requestTitle: req.title,
  };
  s.orders.unshift(order);
  s.orderItems[id] = draft.lines.map((l, i) => ({ id: `${id}-l${i}`, description: l.description, quantity: six(l.quantity), unitPrice: six(l.unitPrice), totalPrice: six(l.totalPrice), currency: draft.currency }));
  q.status = "selected";
  req.status = "awaiting_approval";
  s.approvals.unshift(approvalFor(s, id, stamp));
  return order;
}

function approvalFor(s: DemoState, orderId: string, created: string): ApprovalDTO {
  const o = s.orders.find((x) => x.id === orderId)!;
  const dest = destinationFor(s, o.supplierId);
  return {
    id: `demo-appr-${orderId}`, status: "pending", amount: o.totalAmount, currency: o.currency,
    reason: `Procura recommends ${o.orderNumber}. Payment needs a Passport spending session.`,
    expiresAt: new Date(Date.parse(created) + 7 * DAY).toISOString(), decidedAt: null, createdAt: created,
    orderId, orderNumber: o.orderNumber, orderStatus: o.status, paymentAsset: o.paymentAsset, paymentAmount: o.paymentAmount,
    requestId: o.requestId, requestNumber: o.requestNumber, requestTitle: o.requestTitle,
    supplierId: o.supplierId, supplierName: o.supplierName, supplierSource: "demo", destination: dest,
  };
}

function destinationFor(s: DemoState, supplierId: string): PayoutDestinationDTO | null {
  const mine = s.destinations.filter((d) => d.supplierId === supplierId);
  return mine.find((d) => d.status === "approved") ?? mine.find((d) => d.status === "pending") ?? null;
}

function fakeHash(input: string): string {
  // Demo only: a stable 64 hex string, not a cryptographic hash.
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57, out = "";
  for (let round = 0; round < 8; round++) {
    for (let i = 0; i < input.length; i++) {
      const c = input.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    out += ((h1 >>> 0).toString(16).padStart(8, "0"));
  }
  return out.slice(0, 64);
}

function logActivity(s: DemoState, action: string, resourceType: string, resourceId: string | null, newState: Record<string, unknown> | null, actor: "user" | "system" = "user") {
  s.activity.unshift({
    id: `demo-act-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, actorType: actor, actorId: actor === "user" ? "demo-user" : "demo",
    actorName: actor === "user" ? "Chris Godwin" : null, action, resourceType, resourceId, newState, metadata: {}, createdAt: new Date().toISOString(),
  });
}


/* ------------------------------------------------------------------ */
/* Reads (same shapes as the live API)                                 */
/* ------------------------------------------------------------------ */

export async function demoSuppliers(): Promise<SupplierDTO[]> {
  const s = await getDemo();
  return s.suppliers.map((x) => ({ ...x, evidenceSummary: evidenceFor(s, x.id) }));
}

export async function demoComparison(requestId: string): Promise<ComparisonView> {
  return comparisonFor(await getDemo(), requestId);
}

export async function demoSupplierDetail(id: string): Promise<SupplierDetailDTO> {
  const s = await getDemo();
  const sup = s.suppliers.find((x) => x.id === id);
  if (!sup) throw new ServiceError("NOT_FOUND", "Supplier not found.", 404);
  const quotations: QuotationDTO[] = s.quotes.filter((q) => q.supplierId === id).map((q) => ({
    id: q.id, requestId: q.requestId, supplierId: id, supplierQuoteReference: q.supplierQuoteReference, subtotal: q.subtotal, deliveryCost: q.deliveryCost,
    additionalCosts: q.additionalCosts, totalCost: q.totalCost, currency: q.currency, estimatedDeliveryDays: q.estimatedDeliveryDays,
    quoteStatus: q.status, createdAt: q.createdAt, validUntil: q.validUntil,
  }));
  return {
    supplier: sup,
    evidence: s.evidence.filter((e) => e.supplierId === id).map((e, i) => ({
      id: `${id}-ev${i}`, evidenceType: e.row.evidenceType, sourceName: "Demo dataset (fictional)", verificationStatus: e.row.verificationStatus,
      collectedAt: sup.createdAt, expiresAt: null,
    })),
    payoutDestinations: s.destinations.filter((d) => d.supplierId === id),
    quotations, evidenceSummary: evidenceFor(s, id),
  };
}

export async function demoOrderDetail(id: string): Promise<OrderDetailDTO> {
  const s = await getDemo();
  const o = s.orders.find((x) => x.id === id);
  if (!o) throw new ServiceError("NOT_FOUND", "Purchase order not found.", 404);
  const sup = s.suppliers.find((x) => x.id === o.supplierId) ?? null;
  const appr = s.approvals.filter((a) => a.orderId === id).map(({ id: aid, status, amount, currency, reason, expiresAt, decidedAt, createdAt }) =>
    ({ id: aid, status, amount, currency, reason, expiresAt, decidedAt, createdAt }));
  const { supplierName: _a, supplierSource: _b, requestNumber: _c, requestTitle: _d, ...order } = o;
  return {
    order: { ...order, paymentTerms: "Payable on authorisation", deliveryTerms: "Delivered to the stated location", approvedBy: o.approvedAt ? "demo-user" : null },
    items: s.orderItems[id] ?? [], approvals: appr,
    supplier: sup ? { id: sup.id, name: sup.name, sourceType: sup.sourceType, city: sup.city, countryCode: sup.countryCode } : null,
    request: { id: o.requestId, requestNumber: o.requestNumber, title: o.requestTitle },
    business: { name: s.business.name, address: s.business.address, countryCode: s.business.countryCode },
    destination: destinationFor(s, o.supplierId),
  };
}

/* ------------------------------------------------------------------ */
/* Mutations (simulated persistence)                                   */
/* ------------------------------------------------------------------ */

export async function demoCreateRequest(input: {
  title: string; budgetAmount: string; currency: string; deliveryLocation?: string;
  items: { productName: string; quantity: string; unit: string; category?: string }[];
}): Promise<RequestDetailDTO> {
  const s = await getDemo();
  const n = ++s.counters.request;
  const id = `demo-req-${n}`;
  const now = new Date().toISOString();
  const r: RequestDetailDTO = {
    id, businessId: DEMO_BUSINESS.id, requestNumber: `PR-${String(n).padStart(4, "0")}`, title: input.title, description: null, status: "draft",
    budgetAmount: six(input.budgetAmount), currency: input.currency, deliveryLocation: input.deliveryLocation ?? null, deliveryDeadline: null, priority: "price",
    requestedBy: "demo-user", requestedByName: "Chris Godwin", createdAt: now, updatedAt: now,
    items: input.items.map((i, k) => ({ id: `${id}-i${k}`, requestId: id, productName: i.productName, description: null, category: i.category ?? null, quantity: six(i.quantity), unit: i.unit, specifications: {}, preferredBrand: null })),
  };
  s.requests.unshift(r);
  logActivity(s, "procurement.created", "procurement_request", id, { requestNumber: r.requestNumber, itemCount: r.items.length });
  return r;
}

export async function demoSourcing(requestId: string): Promise<SourcingSummaryDTO> {
  const s = await getDemo();
  if (!s.requests.some((r) => r.id === requestId)) throw new ServiceError("NOT_FOUND", "Procurement request not found.", 404);
  const summary = await runSourcingInto(s, requestId, new DemoSupplierProvider(), new Date().toISOString());
  logActivity(s, "procurement.sourced", "procurement_request", requestId, { status: "comparing" }, "system");
  return summary;
}

export async function demoCreateOrder(requestId: string, quotationId: string, acknowledge: boolean): Promise<OrderDTO> {
  const s = await getDemo();
  const o = createOrderInto(s, requestId, quotationId, acknowledge, new Date().toISOString());
  logActivity(s, "order.created", "purchase_order", o.id, { orderNumber: o.orderNumber });
  return o;
}

export async function demoApprovePayout(destinationId: string): Promise<PayoutDestinationDTO> {
  const s = await getDemo();
  const d = s.destinations.find((x) => x.id === destinationId);
  if (!d) throw new ServiceError("NOT_FOUND", "Payout destination not found.", 404);
  for (const o of s.destinations) if (o.supplierId === d.supplierId && o.status === "approved") o.status = "revoked";
  d.status = "approved"; d.approvedAt = new Date().toISOString();
  logActivity(s, "supplier.payout_destination.approved", "supplier_payout_destination", d.id, { address: d.address });
  return d;
}

export async function demoApproveOrder(orderId: string): Promise<{ orderId: string; fingerprint: string }> {
  const s = await getDemo();
  return approveOrderInto(s, orderId);
}

function approveOrderInto(s: DemoState, orderId: string): { orderId: string; fingerprint: string } {
  const o = s.orders.find((x) => x.id === orderId);
  if (!o) throw new ServiceError("NOT_FOUND", "Purchase order not found.", 404);
  if (o.status !== "pending_approval") throw new ServiceError("INVALID_STATE", `A purchase order that is "${o.status}" cannot be approved.`, 409);
  const dest = destinationFor(s, o.supplierId);
  if (!dest || dest.status !== "approved") throw new ServiceError("RECIPIENT_NOT_APPROVED", "Approve the supplier's payment address before approving this order.", 409);
  const fp = fakeHash(`${o.id}|${o.totalAmount}|${dest.address}`);
  o.status = "approved"; o.approvedFingerprint = fp; o.approvedAt = new Date().toISOString();
  const a = s.approvals.find((x) => x.orderId === orderId && x.status === "pending");
  if (a) { a.status = "approved"; a.decidedAt = o.approvedAt; a.orderStatus = "approved"; }
  const r = s.requests.find((x) => x.id === o.requestId); if (r) r.status = "approved";
  logActivity(s, "order.approved", "purchase_order", o.id, { orderNumber: o.orderNumber });
  return { orderId, fingerprint: fp };
}

export async function demoRejectOrder(orderId: string): Promise<void> {
  const s = await getDemo();
  const o = s.orders.find((x) => x.id === orderId);
  if (!o || o.status !== "pending_approval") throw new ServiceError("INVALID_STATE", "This order cannot be rejected.", 409);
  o.status = "cancelled";
  const a = s.approvals.find((x) => x.orderId === orderId && x.status === "pending");
  if (a) { a.status = "rejected"; a.orderStatus = "cancelled"; a.decidedAt = new Date().toISOString(); }
  const r = s.requests.find((x) => x.id === o.requestId); if (r) r.status = "comparing";
  const q = s.quotes.find((x) => x.id === o.quotationId); if (q) q.status = "received";
  logActivity(s, "order.rejected", "purchase_order", o.id, { orderNumber: o.orderNumber });
}

/**
 * The simulated Kite Passport payment. Clearly demo: the hash is invented and nothing is sent
 * anywhere. For the guided tour it also approves a pending payout address, which a real
 * deployment would require a person to do separately first.
 */
export async function demoExecutePayment(orderId: string): Promise<PaymentDTO> {
  const s = await getDemo();
  const o = s.orders.find((x) => x.id === orderId);
  if (!o) throw new ServiceError("NOT_FOUND", "Purchase order not found.", 404);
  const dest = destinationFor(s, o.supplierId);
  if (!dest) throw new ServiceError("RECIPIENT_NOT_APPROVED", "This supplier has no payment address.", 409);
  if (dest.status !== "approved") await demoApprovePayout(dest.id);
  if (o.status === "pending_approval") approveOrderInto(s, orderId);
  if (o.status !== "approved") throw new ServiceError("INVALID_STATE", `A purchase order that is "${o.status}" cannot be paid.`, 409);

  const now = new Date().toISOString();
  const p: PaymentDTO = {
    id: `demo-pay-${s.payments.length + 1}`, status: "confirmed", amount: o.paymentAmount, asset: o.paymentAsset, network: PAYMENT_NETWORK,
    recipientAddress: destinationFor(s, o.supplierId)!.address, transactionHash: `0x${fakeHash(`${o.id}-${now}`)}`, failureReason: null,
    confirmedAt: now, createdAt: now, orderId: o.id, orderNumber: o.orderNumber, supplierId: o.supplierId, supplierName: o.supplierName,
  };
  s.payments.unshift(p);
  o.status = "paid";
  const r = s.requests.find((x) => x.id === o.requestId); if (r) r.status = "processing";
  logActivity(s, "payment.confirmed", "payment", p.id, { orderNumber: o.orderNumber, amount: p.amount });
  return p;
}
