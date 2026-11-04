import { PAYMENT_ASSET } from "@procura/shared";
import type { ConversionRate } from "@procura/procurement";
import { serverEnv } from "./env";

/**
 * The rate used to turn a quote currency into the payment asset. It comes from the server, never
 * from the request body, because a caller-supplied rate would let someone change what is paid.
 *
 * No market-rate source is integrated. Outside production a clearly labelled fixed 1:1 USD peg is
 * available for the demo (USDC.e is a dollar stablecoin). In production, with no source, this
 * returns undefined and order creation fails with PAYMENT_CONVERSION_REQUIRED, which is the
 * safe outcome: Procura will not guess a rate.
 */
export function conversionFor(quoteCurrency: string, now = new Date()): ConversionRate | undefined {
  if (quoteCurrency === PAYMENT_ASSET) return undefined; // same currency, nothing to convert
  const env = serverEnv();
  if (quoteCurrency === "USD" && env.ALLOW_FIXED_USD_PEG === "true") {
    return { rate: "1.000000", asOf: now, source: "fixed 1:1 demo peg (not a market rate)" };
  }
  return undefined;
}
