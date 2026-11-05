import { add, compare, fromUnits, money, multiply, subtract, toUnits } from "@procura/shared";

/** The recipient recorded for a purchase that is paid at a marketplace checkout rather than to a supplier address. */
export const MARKETPLACE_RECIPIENT = "marketplace-checkout";

/** Amazon's checkout fee through Kite Passport, in USD. */
export const AMAZON_CHECKOUT_FEE = "1.00";

const cents = (a: string) => fromUnits(toUnits(a), undefined, 2);

export interface CheckoutLimits {
  /** What the person's items cost before shipping and tax. */
  subtotal: string;
  /** The most the order may cost: the subtotal plus the larger of 20% or $5. Anything above it is refused. */
  cap: string;
  fee: string;
  /** What is held up front: the cap plus the fee. Unused cap is refunded. */
  charge: string;
}

/**
 * Amazon checkout through Passport (docs.gokite.ai): a cap of the cart subtotal plus the larger of
 * 20% or $5 is held, plus a $1 fee, and whatever the order does not use is refunded. A session for a
 * checkout must be at least the charge, and the allowance never pays a checkout.
 */
export function amazonCheckoutLimits(subtotal: string): CheckoutLimits {
  const sub = money(subtotal, "USD");
  const pct = multiply(sub, "0.20");
  const headroom = compare(pct, money("5", "USD")) > 0 ? pct : money("5", "USD");
  const cap = add(sub, headroom);
  const charge = add(cap, money(AMAZON_CHECKOUT_FEE, "USD"));
  return { subtotal: cents(sub.amount), cap: cents(cap.amount), fee: AMAZON_CHECKOUT_FEE, charge: cents(charge.amount) };
}

export interface CheckoutSettlement {
  held: string;
  /** What the order really cost: the order total plus the fee. */
  settled: string;
  refunded: string;
}

/** What a finished checkout leaves: the charge was held, the order and fee were taken, the rest comes back. */
export function settleCheckout(limits: CheckoutLimits, orderTotal: string): CheckoutSettlement {
  const settled = add(money(orderTotal, "USD"), money(limits.fee, "USD"));
  const refunded = subtract(money(limits.charge, "USD"), settled);
  return { held: limits.charge, settled: cents(settled.amount), refunded: cents(refunded.amount) };
}

/** True when the order, with shipping and tax, is above what the checkout is allowed to charge. */
export function exceedsCap(limits: CheckoutLimits, orderTotal: string): boolean {
  return compare(money(orderTotal, "USD"), money(limits.cap, "USD")) > 0;
}
