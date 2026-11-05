import { PAYMENT_ASSET, PAYMENT_NETWORK } from "@procura/shared";
import type {
  EvidenceInput, QuotationRequest, QuotationResult, SupplierProvider, SupplierSearchQuery, SupplierSearchResult,
} from "./types";

/**
 * DemoSupplierProvider (Technical PRD s9.2): a small fictional dataset for a desk setup (chargers, a lamp, notebooks).
 *
 * Everything here is invented for demonstration. It is stored with source_type = 'demo' and
 * every UI must label it as demo data. It is never presented as live, verified supplier data.
 */

const DEMO_SOURCE = "Demo dataset (fictional)";

interface DemoSupplier extends Omit<SupplierSearchResult, "sourceType" | "evidence"> {
  /** keyword -> unit price (USD) */
  prices: Record<string, string>;
  deliveryCost: string;
  deliveryDays: number;
  evidenceFlags: Partial<Record<EvidenceInput["evidenceType"], EvidenceInput["verificationStatus"]>>;
}

const KEYWORDS = ["charger", "lamp", "notebook"] as const;
const keywordFor = (name: string) => KEYWORDS.find((k) => name.toLowerCase().includes(k)) ?? null;

const CATALOGUE: DemoSupplier[] = [
  {
    externalRef: "demo-harbor",
    name: "Harbor Electronics",
    legalName: "Harbor Electronics Ltd (demo)",
    description: "Fictional electronics and desk accessories shop.",
    city: "Lagos", countryCode: "NG", email: "sales@harbor.demo.invalid", phone: "+234 000 000 0001",
    categories: ["electronics", "office"],
    matchedItems: [],
    prices: { charger: "8.50", lamp: "17.00", notebook: "3.75" },
    deliveryCost: "6.00", deliveryDays: 5,
    // No delivery history yet: a concern, not a blocker.
    evidenceFlags: { business_identity: "verified", contact_information: "verified", payment_destination: "verified" },
    payoutDestination: { address: "0xDe30000000000000000000000000000000000001", network: PAYMENT_NETWORK, asset: PAYMENT_ASSET },
  },
  {
    externalRef: "demo-northgate",
    name: "Northgate Supply",
    legalName: "Northgate Supply Co (demo)",
    description: "Fictional seller of desk and stationery items with a full evidence trail.",
    city: "Lagos", countryCode: "NG", email: "sales@northgate.demo.invalid", phone: "+234 000 000 0002",
    categories: ["office", "electronics", "stationery"],
    matchedItems: [],
    prices: { charger: "8.00", lamp: "16.50", notebook: "3.50" },
    deliveryCost: "4.00", deliveryDays: 4,
    evidenceFlags: {
      business_identity: "verified", contact_information: "verified", payment_destination: "verified",
      delivery_history: "verified",
    },
    payoutDestination: { address: "0xDe30000000000000000000000000000000000002", network: PAYMENT_NETWORK, asset: PAYMENT_ASSET },
  },
  {
    externalRef: "demo-cornertech",
    name: "Corner Tech Shop",
    legalName: "Corner Tech Shop Ltd (demo)",
    description: "Fictional shop with missing verification evidence.",
    city: "Ibadan", countryCode: "NG",
    categories: ["electronics", "office"],
    matchedItems: [],
    prices: { charger: "8.75", lamp: "17.50", notebook: "3.85" },
    deliveryCost: "2.50", deliveryDays: 3,
    // Contact and payment destination were never verified. Missing means unknown, so this
    // seller needs review and is not recommended automatically.
    evidenceFlags: { business_identity: "verified" },
    payoutDestination: { address: "0xDe30000000000000000000000000000000000003", network: PAYMENT_NETWORK, asset: PAYMENT_ASSET },
  },
];

export interface DemoProviderOptions {
  /**
   * The controlled testnet recipient used for the live payment demo. When set, every demo supplier
   * proposes this address, so a real transfer goes to a wallet we control and never to a stranger.
   */
  recipientOverride?: string;
}

export class DemoSupplierProvider implements SupplierProvider {
  readonly name = "demo";
  constructor(private readonly options: DemoProviderOptions = {}) {}

  private toResult(s: DemoSupplier, matched: string[]): SupplierSearchResult {
    const evidence: EvidenceInput[] = [
      ...Object.entries(s.evidenceFlags).map(([type, status]) => ({
        evidenceType: type as EvidenceInput["evidenceType"],
        verificationStatus: status!,
        sourceName: DEMO_SOURCE,
        data: { demo: true },
      })),
      { evidenceType: "quotation", verificationStatus: "verified", sourceName: DEMO_SOURCE, data: { demo: true } },
    ];
    const { prices: _p, deliveryCost: _d, deliveryDays: _dd, evidenceFlags: _e, ...rest } = s;
    return {
      ...rest,
      sourceType: "demo",
      matchedItems: matched,
      evidence,
      payoutDestination: s.payoutDestination
        ? { ...s.payoutDestination, address: this.options.recipientOverride ?? s.payoutDestination.address }
        : undefined,
    };
  }

  async searchSuppliers(query: SupplierSearchQuery): Promise<SupplierSearchResult[]> {
    const results: SupplierSearchResult[] = [];
    for (const s of CATALOGUE) {
      const matched = query.items.filter((i) => {
        const k = keywordFor(i.name);
        return k !== null && k in s.prices;
      });
      if (matched.length === 0) continue;
      results.push(this.toResult(s, matched.map((m) => m.name)));
    }
    return results;
  }

  async getSupplierDetails(externalRef: string): Promise<SupplierSearchResult | null> {
    const s = CATALOGUE.find((c) => c.externalRef === externalRef);
    return s ? this.toResult(s, []) : null;
  }

  async getQuotations(externalRef: string, request: QuotationRequest): Promise<QuotationResult[]> {
    const s = CATALOGUE.find((c) => c.externalRef === externalRef);
    if (!s) return [];

    const lines: QuotationResult["lines"] = [];
    let unmatched = 0;
    for (const item of request.items) {
      const k = keywordFor(item.name);
      const price = k ? s.prices[k] : undefined;
      if (!price) { unmatched++; continue; }
      lines.push({ description: item.name, quantity: item.quantity, unitPrice: price });
    }
    if (lines.length === 0) return [];

    return [{
      supplierExternalRef: externalRef,
      supplierQuoteReference: `DEMO-${externalRef.replace("demo-", "").toUpperCase()}-${request.items.length}`,
      // The dataset is priced in USD. Procura never converts silently: a request in another
      // currency simply yields a USD quote that the eligibility check marks CURRENCY_MISMATCH.
      currency: "USD",
      lines,
      deliveryCost: s.deliveryCost,
      additionalCosts: "0.00",
      unknownCosts: [],
      estimatedDeliveryDays: s.deliveryDays,
      availability: unmatched === 0 ? "available" : "partial",
      validForDays: 7,
      sourceType: "demo",
      sourceReference: `${DEMO_SOURCE}:${externalRef}`,
    }];
  }
}
