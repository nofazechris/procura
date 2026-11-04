/**
 * Money is a decimal string plus an explicit currency or asset code.
 * All arithmetic goes through BigInt base units. JavaScript floats are never used
 * for financial values (Technical PRD s5, s10.1, s11.2).
 */

/** Matches the NUMERIC(20,6) columns. USDC.e has 6 decimals, so 6 is the common scale. */
export const MONEY_SCALE = 6;

const DECIMAL = /^-?\d+(\.\d+)?$/;

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

export interface Money {
  amount: string;
  currency: string;
}

/** Parse a decimal string into BigInt base units. Rejects more fractional digits than `scale`. */
export function toUnits(amount: string, scale: number = MONEY_SCALE): bigint {
  const trimmed = amount.trim();
  if (!DECIMAL.test(trimmed)) throw new MoneyError(`Invalid decimal amount: "${amount}"`);
  const negative = trimmed.startsWith("-");
  const body = negative ? trimmed.slice(1) : trimmed;
  const [whole = "0", frac = ""] = body.split(".");
  if (frac.length > scale) {
    throw new MoneyError(`Amount "${amount}" has more than ${scale} decimal places`);
  }
  const units = BigInt(whole) * 10n ** BigInt(scale) + BigInt(frac.padEnd(scale, "0") || "0");
  return negative ? -units : units;
}

/** Format BigInt base units back to a decimal string with exactly `places` fractional digits. */
export function fromUnits(units: bigint, scale: number = MONEY_SCALE, places: number = 2): string {
  if (places > scale) throw new MoneyError("places cannot exceed scale");
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const divisor = 10n ** BigInt(scale);
  let whole = abs / divisor;
  let frac = abs % divisor;
  // Round half up when dropping digits beyond `places`.
  const drop = BigInt(scale - places);
  if (drop > 0n) {
    const step = 10n ** drop;
    const rem = frac % step;
    frac = frac / step;
    if (rem * 2n >= step) {
      frac += 1n;
      if (frac >= 10n ** BigInt(places)) {
        frac = 0n;
        whole += 1n;
      }
    }
  }
  const fracStr = places > 0 ? "." + frac.toString().padStart(places, "0") : "";
  return `${negative ? "-" : ""}${whole.toString()}${fracStr}`;
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new MoneyError(
      `Currency mismatch: ${a.currency} vs ${b.currency}. Convert with an explicit rate first.`,
    );
  }
}

export function money(amount: string, currency: string): Money {
  toUnits(amount); // validate
  if (!currency.trim()) throw new MoneyError("Currency is required");
  return { amount: fromUnits(toUnits(amount), MONEY_SCALE, 2), currency };
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { amount: fromUnits(toUnits(a.amount) + toUnits(b.amount)), currency: a.currency };
}

export function sum(items: Money[], currency: string): Money {
  return items.reduce((acc, m) => add(acc, m), { amount: "0.00", currency });
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { amount: fromUnits(toUnits(a.amount) - toUnits(b.amount)), currency: a.currency };
}

/** Returns -1, 0 or 1. */
export function compare(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b);
  const x = toUnits(a.amount);
  const y = toUnits(b.amount);
  return x < y ? -1 : x > y ? 1 : 0;
}

/**
 * Quantity x unit price. Quantity is a decimal string too, so fractional quantities
 * (e.g. 2.5 kg) stay exact. The product is rounded half up to 2 places.
 */
export function multiply(unitPrice: Money, quantity: string): Money {
  const price = toUnits(unitPrice.amount);
  const qty = toUnits(quantity);
  const product = (price * qty) / 10n ** BigInt(MONEY_SCALE);
  return { amount: fromUnits(product), currency: unitPrice.currency };
}

export function isNonNegative(m: Money): boolean {
  return toUnits(m.amount) >= 0n;
}

export function formatMoney(m: Money, locale = "en-US"): string {
  const [whole = "0", frac = "00"] = m.amount.split(".");
  const negative = whole.startsWith("-");
  const digits = negative ? whole.slice(1) : whole;
  const grouped = new Intl.NumberFormat(locale).format(BigInt(digits));
  return `${negative ? "-" : ""}${grouped}.${frac} ${m.currency}`;
}
