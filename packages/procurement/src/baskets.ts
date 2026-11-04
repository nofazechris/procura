/**
 * How a basket is chosen from marketplace listings. Pure and browser-safe: the server uses it to
 * build real options from an Amazon search, and the landing page runs the same function in the
 * visitor's browser, so what they play with is the real rule and not a picture of it.
 */

/** One product listing found on a marketplace. Price is a decimal USD string such as "19.99". */
export interface BasketListing {
  /** The retailer's own product id (an Amazon ASIN). */
  id: string;
  title: string;
  price: string;
  rating: number | null;
  reviews: number | null;
  /** The product page on the retailer's site. */
  link: string;
}

export type Strategy = "cheapest" | "top-rated" | "balanced";

export const STRATEGIES: readonly Strategy[] = ["cheapest", "balanced", "top-rated"];

export const STRATEGY_LABEL: Record<Strategy, string> = {
  cheapest: "Cheapest picks",
  "top-rated": "Top-rated picks",
  balanced: "Balanced picks",
};

const cmpPrice = (a: BasketListing, b: BasketListing) => Number(a.price) - Number(b.price);
const byRating = (a: BasketListing, b: BasketListing) =>
  (b.rating ?? 0) - (a.rating ?? 0) || (b.reviews ?? 0) - (a.reviews ?? 0) || cmpPrice(a, b);

/** Which listing a strategy buys for one item, or null when there is nothing to choose from. */
export function pickListing(strategy: Strategy, listings: BasketListing[]): BasketListing | null {
  if (listings.length === 0) return null;
  const cheapest = [...listings].sort(cmpPrice)[0]!;
  if (strategy === "cheapest") return cheapest;
  if (strategy === "top-rated") return [...listings].sort(byRating)[0]!;
  // Balanced: the best-rated listing that costs no more than a quarter above the cheapest.
  const ceiling = Number(cheapest.price) * 1.25;
  return listings.filter((l) => Number(l.price) <= ceiling).sort(byRating)[0] ?? cheapest;
}

/** One listing per requested item, under a strategy. Items with no listings are simply absent. */
export function buildBasket(strategy: Strategy, byItem: Record<string, BasketListing[]>): Record<string, BasketListing> {
  const out: Record<string, BasketListing> = {};
  for (const [item, listings] of Object.entries(byItem)) {
    const p = pickListing(strategy, listings);
    if (p) out[item] = p;
  }
  return out;
}
