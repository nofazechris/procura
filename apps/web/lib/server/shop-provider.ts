import {
  pickListing, STRATEGIES, STRATEGY_LABEL, type QuotationRequest, type QuotationResult, type Strategy, type SupplierProvider, type SupplierSearchQuery,
  type SupplierSearchResult,
} from "@procura/procurement";
import { shopSearch, type ShopListing } from "./passport";

/**
 * Finds products on Amazon through Kite Passport and turns them into comparable options.
 *
 * Amazon is not a supplier we pay directly: it is a marketplace paid through checkout. So the option a
 * person compares is a whole basket (one listing per requested item), and there are up to three
 * baskets built by different rules: the cheapest picks, the top-rated picks, and a balance of the two.
 * Each shows as its own row, and a person can see exactly which listing is behind every line.
 *
 * Searching is free and buys nothing. Prices are as listed; shipping and tax are added at checkout, so
 * every basket says so and its total is marked as understated.
 */

/** Which listing each strategy buys for one item (the shared, browser-safe rule). */
export const pick = pickListing;

export class AmazonShopProvider implements SupplierProvider {
  readonly name = "amazon-via-passport";
  private baskets = new Map<string, Map<string, ShopListing>>();
  private cache = new Map<string, ShopListing[]>();

  constructor(private readonly search: (q: string, max?: number) => Promise<ShopListing[]> = shopSearch) {}

  /**
   * Runs the searches ahead of time. Sourcing happens inside a database transaction, and a slow
   * network call should not hold one open, so the route fetches first and sourcing reads the cache.
   */
  async prefetch(items: { name: string }[]): Promise<void> {
    // A few searches at a time: polite to Passport, and fast enough for a short list.
    for (let i = 0; i < items.length; i += 3) {
      await Promise.all(items.slice(i, i + 3).map(async (it) => { this.cache.set(it.name, await this.search(it.name, 6)); }));
    }
  }

  async searchSuppliers(query: SupplierSearchQuery): Promise<SupplierSearchResult[]> {
    this.baskets.clear();
    const items = [...query.items];
    await this.prefetch(items.filter((i) => !this.cache.has(i.name)));
    const found = new Map(items.map((i) => [i.name, this.cache.get(i.name) ?? []] as const));
    const matched = items.filter((i) => (found.get(i.name) ?? []).length > 0).map((i) => i.name);
    if (matched.length === 0) return [];

    const seen = new Set<string>();
    const results: SupplierSearchResult[] = [];
    for (const strategy of STRATEGIES) {
      const picks = new Map<string, ShopListing>();
      for (const name of matched) {
        const p = pickListing(strategy, found.get(name) ?? []);
        if (p) picks.set(name, p);
      }
      const signature = [...picks.entries()].map(([n, l]) => `${n}=${l.id}`).sort().join("|");
      if (seen.has(signature)) continue; // the same basket under another rule adds nothing
      seen.add(signature);
      const ref = `amazon:${strategy}`;
      this.baskets.set(ref, picks);
      results.push({
        externalRef: ref, name: `Amazon: ${STRATEGY_LABEL[strategy]}`, description: "Products listed on Amazon, bought through checkout.",
        categories: [], sourceType: "marketplace", matchedItems: matched,
        evidence: [
          { evidenceType: "business_identity", verificationStatus: "verified", sourceName: "Amazon via Kite Passport", sourceUrl: "https://www.amazon.com" },
          { evidenceType: "quotation", verificationStatus: "verified", sourceName: "Amazon via Kite Passport", data: { method: "shop:search" }, validForDays: 1 },
        ],
      });
    }
    return results;
  }

  async getSupplierDetails(): Promise<SupplierSearchResult | null> {
    return null;
  }

  async getQuotations(externalRef: string, request: QuotationRequest): Promise<QuotationResult[]> {
    const picks = this.baskets.get(externalRef);
    // Amazon prices are in USD and Procura has no exchange rate feed, so no other currency is ever quoted.
    if (!picks || request.currency !== "USD") return [];
    const lines = request.items.flatMap((it) => {
      const l = picks.get(it.name);
      return l
        ? [{ description: it.name, quantity: it.quantity, unitPrice: l.price, listing: { id: l.id, title: l.title, link: l.link, rating: l.rating, reviews: l.reviews } }]
        : [];
    });
    if (lines.length === 0) return [];
    return [{
      supplierExternalRef: externalRef,
      supplierQuoteReference: `${externalRef}:${new Date().toISOString().slice(0, 10)}`,
      currency: "USD", lines, deliveryCost: "0.00", additionalCosts: "0.00",
      unknownCosts: ["shipping", "tax"], estimatedDeliveryDays: null,
      // A listing that shows a price in search is orderable; checkout confirms final availability.
      availability: "available", validForDays: 1, sourceType: "marketplace",
      sourceReference: "Amazon search through Kite Passport (kpass shop:search). Shipping and tax are added at checkout.",
    }];
  }
}
