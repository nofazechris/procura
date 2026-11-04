import { beforeAll, describe, expect, it } from "vitest";
import type { SupplierEvidenceSummary } from "@procura/shared";
import { evaluateEligibility, type Quote, type Requirement } from "@procura/procurement/core";
import { linesForView } from "../../packages/procurement/src/services/comparison";
import { parseShopListings, parseUsdPrice, type ShopListing } from "../../apps/web/lib/server/passport";
import { AmazonShopProvider, pick } from "../../apps/web/lib/server/shop-provider";

beforeAll(() => {
  process.env.DATABASE_URL = "postgres://x/y";
  process.env.BETTER_AUTH_SECRET = "test-secret-test-secret-test-secret-123456";
});

const L = (id: string, price: string, rating: number | null, reviews: number | null, title = `Item ${id}`): ShopListing =>
  ({ id, title, price, rating, reviews, link: `https://www.amazon.com/dp/${id}` });

describe("parsing Passport's Amazon search", () => {
  it("reads dollar prices exactly and refuses anything that is not one clear price", () => {
    expect(parseUsdPrice("$19.99")).toBe("19.99");
    expect(parseUsdPrice("$1,299.00")).toBe("1299.00");
    expect(parseUsdPrice("$7")).toBe("7.00");
    expect(parseUsdPrice("$7.5")).toBe("7.50");
    for (const bad of ["$19.99 - $29.99", "19.99", "€19.99", "$0.00", "$-5", "free", "$1,29.00", "", null, undefined, 12.5, "$19.999"]) {
      expect(parseUsdPrice(bad)).toBeNull();
    }
  });

  it("keeps good listings, rebuilds the link from the product id, and drops everything suspicious", () => {
    const listings = parseShopListings({
      items: [
        { external_identifier: "B0H7BYWCNG", provider: "amazon", price: "$19.99", title: "  Anker   Charger  ", rating: 4.8, reviews: 168, link: "https://evil.example/steal?x=1" },
        { external_identifier: "B0DZ5KG7XG", provider: "amazon", price: "$9.99", title: "Cheap", rating: 4.2, reviews: 3200 },
        { external_identifier: "lowercase1", provider: "amazon", price: "$5.00", title: "bad id" },
        { external_identifier: "B0XXXXXXXX", provider: "ebay", price: "$5.00", title: "wrong store" },
        { external_identifier: "B0YYYYYYYY", provider: "amazon", price: "call us", title: "no price" },
        { external_identifier: "B0ZZZZZZZZ", provider: "amazon", price: "$5.00", title: "" },
        { external_identifier: "B0RATINGBAD", provider: "amazon", price: "$5.00", title: "x", rating: 9, reviews: -3 },
        "not an object", null,
      ],
    });
    expect(listings.map((l) => l.id)).toEqual(["B0H7BYWCNG", "B0DZ5KG7XG"]);
    expect(listings[0]).toMatchObject({ title: "Anker Charger", price: "19.99", link: "https://www.amazon.com/dp/B0H7BYWCNG" });
    expect(JSON.stringify(listings)).not.toMatch(/evil\.example/);
    expect(parseShopListings(null)).toEqual([]);
    expect(parseShopListings({ items: "nope" })).toEqual([]);
  });
});

describe("basket strategies", () => {
  const a = L("AAAAAAAAAA", "10.00", 3.9, 40), b = L("BBBBBBBBBB", "12.00", 4.8, 900), c = L("CCCCCCCCCC", "30.00", 5, 12);
  it("cheapest takes the lowest price, top-rated the best rating, balanced the best rating within a quarter of the cheapest", () => {
    expect(pick("cheapest", [a, b, c])?.id).toBe(a.id);
    expect(pick("top-rated", [a, b, c])?.id).toBe(c.id);
    expect(pick("balanced", [a, b, c])?.id).toBe(b.id); // 12 <= 12.5, and rated above the cheapest
    expect(pick("balanced", [a, c])?.id).toBe(a.id);    // 30 is far above the cheapest
    expect(pick("cheapest", [])).toBeNull();
  });
});

describe("AmazonShopProvider", () => {
  const catalog: Record<string, ShopListing[]> = {
    rice: [L("RICE000001", "20.00", 4.0, 100), L("RICE000002", "24.00", 4.8, 800)],
    oil: [L("OIL0000001", "8.00", 4.5, 300)],
    unicorn: [],
  };
  const make = () => new AmazonShopProvider(async (q) => catalog[q] ?? []);
  const items = (names: string[]) => names.map((name) => ({ name, quantity: "2" }));

  it("builds distinct baskets, labels them, and drops duplicates of the same basket", async () => {
    const p = make();
    const found = await p.searchSuppliers({ items: items(["rice", "oil"]) });
    expect(found.map((f) => f.externalRef)).toEqual(["amazon:cheapest", "amazon:balanced"]); // balanced == top-rated here
    expect(found.every((f) => f.sourceType === "marketplace")).toBe(true);
    expect(found[0]!.evidence.map((e) => e.evidenceType).sort()).toEqual(["business_identity", "quotation"]);
  });

  it("quotes real listings with the product behind every line, and says shipping and tax are unknown", async () => {
    const p = make();
    await p.searchSuppliers({ items: items(["rice", "oil"]) });
    const [q] = await p.getQuotations("amazon:cheapest", { currency: "USD", items: items(["rice", "oil"]) });
    expect(q).toMatchObject({ currency: "USD", deliveryCost: "0.00", unknownCosts: ["shipping", "tax"], estimatedDeliveryDays: null, sourceType: "marketplace" });
    expect(q!.lines).toEqual([
      expect.objectContaining({ description: "rice", quantity: "2", unitPrice: "20.00", listing: expect.objectContaining({ id: "RICE000001" }) }),
      expect.objectContaining({ description: "oil", quantity: "2", unitPrice: "8.00" }),
    ]);
  });

  it("never quotes in another currency, never invents a basket, and returns nothing when nothing is found", async () => {
    const p = make();
    await p.searchSuppliers({ items: items(["rice"]) });
    expect(await p.getQuotations("amazon:cheapest", { currency: "NGN", items: items(["rice"]) })).toEqual([]);
    expect(await p.getQuotations("amazon:made-up", { currency: "USD", items: items(["rice"]) })).toEqual([]);
    expect(await make().searchSuppliers({ items: items(["unicorn"]) })).toEqual([]);
  });

  it("a partial basket only holds what was found, so the engine will flag the missing item", async () => {
    const p = make();
    await p.searchSuppliers({ items: items(["rice", "unicorn"]) });
    const [q] = await p.getQuotations("amazon:cheapest", { currency: "USD", items: items(["rice", "unicorn"]) });
    expect(q!.lines.map((l) => l.description)).toEqual(["rice"]);
  });
});

describe("eligibility depends on how the supplier is paid", () => {
  const now = new Date("2026-11-04T10:00:00Z");
  const requirement: Requirement = { currency: "USD", budget: "100.00", maxDeliveryDays: null, items: [{ id: "i1", name: "rice", quantity: "2" }] };
  const quote: Quote = {
    id: "q1", supplierId: "s1", currency: "USD", lines: [{ description: "rice", quantity: "2", unitPrice: "20.00" }], subtotal: "40.00",
    deliveryCost: "0.00", additionalCosts: "0.00", totalCost: "40.00", unknownCosts: [], estimatedDeliveryDays: null, availability: "available",
    status: "received", validUntil: new Date(now.getTime() + 86_400_000),
  };
  const ev = (over: Partial<SupplierEvidenceSummary> = {}): SupplierEvidenceSummary => ({
    identityVerified: true, contactVerified: null, quotationReceived: true, paymentDestinationMatched: null, historicalPerformanceAvailable: false, unresolvedConcerns: [], ...over,
  });
  const run = (route: "supplier_payout" | "marketplace_checkout" | undefined, evidence: SupplierEvidenceSummary) =>
    evaluateEligibility(quote, requirement, { supplierId: "s1", restricted: false, evidence, ...(route ? { paymentRoute: route } : {}) }, now);

  it("a marketplace needs no supplier contact or payout address, a direct supplier still does", () => {
    expect(run("marketplace_checkout", ev()).verdict).toBe("eligible");
    expect(run("supplier_payout", ev()).verdict).toBe("review_required");
    expect(run(undefined, ev()).reasons).toEqual(expect.arrayContaining(["CONTACT_NOT_VERIFIED", "PAYMENT_DESTINATION_NOT_VERIFIED"]));
  });

  it("a marketplace still fails closed on identity, and an unknown identity is never treated as verified", () => {
    expect(run("marketplace_checkout", ev({ identityVerified: null })).verdict).toBe("review_required");
    expect(run("marketplace_checkout", ev({ identityVerified: false })).verdict).toBe("ineligible");
  });

  it("a marketplace is still held to the budget and to unknown costs being flagged", () => {
    const over = evaluateEligibility({ ...quote, totalCost: "140.00", subtotal: "140.00", unknownCosts: ["shipping", "tax"] }, requirement,
      { supplierId: "s1", restricted: false, evidence: ev(), paymentRoute: "marketplace_checkout" }, now);
    expect(over.verdict).toBe("ineligible");
    expect(over.reasons).toContain("OVER_BUDGET");
    expect(over.concerns.join(" ")).toMatch(/shipping, tax/);
  });
});

describe("listing display data from storage is untrusted", () => {
  const base = { description: "rice", quantity: "2", unitPrice: "20.00" };
  it("keeps a good Amazon listing and falls back to plain lines when the listing is not trustworthy", () => {
    const good = { ...base, listing: { id: "RICE000001", title: "Rice", link: "https://www.amazon.com/dp/RICE000001", rating: 4.5, reviews: 10 } };
    expect(linesForView([good])).toEqual([good]);
    const evil = { ...base, listing: { ...good.listing, link: "https://evil.example/phish" } };
    expect(linesForView([evil])).toEqual([base]);
    const js = { ...base, listing: { ...good.listing, link: "javascript:alert(1)" } };
    expect(linesForView([js])).toEqual([base]);
    expect(linesForView("garbage")).toEqual([]);
  });
});
