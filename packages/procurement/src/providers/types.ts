import type { EvidenceType, SupplierSourceType, VerificationStatus } from "@procura/shared";

export interface SupplierSearchQuery {
  items: { name: string; quantity: string }[];
  categories?: string[];
  location?: string;
}

export interface EvidenceInput {
  evidenceType: EvidenceType;
  verificationStatus: VerificationStatus;
  sourceName: string;
  sourceUrl?: string;
  data?: Record<string, unknown>;
  /** Days until this evidence goes stale. Omit for non-expiring. */
  validForDays?: number;
}

export interface PayoutDestinationInput {
  address: string;
  network: string;
  asset: string;
}

/** Every provider returns this same internal shape (Technical PRD s9.1). */
export interface SupplierSearchResult {
  externalRef: string;
  name: string;
  legalName?: string;
  description?: string;
  city?: string;
  countryCode?: string;
  email?: string;
  phone?: string;
  categories: string[];
  sourceType: SupplierSourceType;
  /** Request item names this supplier can supply. */
  matchedItems: string[];
  evidence: EvidenceInput[];
  /** Proposed only. A human must approve it before Procura can ever pay it. */
  payoutDestination?: PayoutDestinationInput;
}

/** The marketplace listing behind a quote line, kept so a person can see exactly what would be bought. */
export interface ListingRef {
  /** The retailer's own product id (an Amazon ASIN). */
  id: string;
  title: string;
  /** Link to the listing on the retailer's site. */
  link: string;
  rating: number | null;
  reviews: number | null;
}

export interface QuotationResult {
  supplierExternalRef: string;
  supplierQuoteReference: string;
  currency: string;
  lines: { description: string; quantity: string; unitPrice: string; listing?: ListingRef }[];
  deliveryCost: string;
  additionalCosts: string;
  unknownCosts: string[];
  estimatedDeliveryDays: number | null;
  availability: "available" | "partial" | "unavailable" | "unknown";
  validForDays: number;
  sourceType: SupplierSourceType;
  /** Where this quote came from, for the evidence trail. */
  sourceReference: string;
}

export interface QuotationRequest {
  currency: string;
  items: { name: string; quantity: string }[];
}

export interface SupplierProvider {
  readonly name: string;
  searchSuppliers(query: SupplierSearchQuery): Promise<SupplierSearchResult[]>;
  getSupplierDetails(externalRef: string): Promise<SupplierSearchResult | null>;
  getQuotations?(externalRef: string, request: QuotationRequest): Promise<QuotationResult[]>;
}
