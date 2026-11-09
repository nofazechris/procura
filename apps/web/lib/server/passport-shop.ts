import { ServiceError } from "@procura/shared";
import { parseUsdPrice, runKpass, type KpassResult, type PaidFailure } from "./passport";

/**
 * Real shopping through Kite Passport: delivery details, the cart, checkout and order status.
 * Everything runs through the `kpass` CLI with an argument array and no shell. Nothing here decides
 * whether to spend: the caller has already checked the order, the limits and the person's confirmation.
 */

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const ASIN = /^[A-Z0-9]{10}$/;

/* ---------------------------- delivery details ---------------------------- */

export interface ShippingProfile {
  name: string; email: string; phone: string; line1: string; line2: string; city: string; state: string; postalCode: string; country: string;
  missing: string[]; complete: boolean;
}

export function parseShipping(json: Record<string, unknown> | null): ShippingProfile {
  const j = json ?? {};
  const s = (k: string) => (typeof j[k] === "string" ? (j[k] as string) : "");
  const missing = Array.isArray(j["missing"]) ? (j["missing"] as unknown[]).filter((m): m is string => typeof m === "string") : [];
  // Anything that does not say "complete" outright is treated as incomplete.
  return {
    name: s("name"), email: s("email"), phone: s("phone"), line1: s("line1"), line2: s("line2"), city: s("city"), state: s("state"),
    postalCode: s("postal_code"), country: s("country") || "US", missing, complete: j["complete"] === true && missing.length === 0,
  };
}

export async function shippingView(): Promise<ShippingProfile> {
  return parseShipping((await runKpass(["shop:shipping", "view"], [4])).json);
}

export interface ShippingInput { name: string; email: string; phone: string; line1: string; line2?: string; city: string; state: string; postal: string; country: string }

const digits = (p: string) => p.replace(/[\s().+-]/g, "");

/** Checks delivery details before they are handed to the CLI. A plain message for the first problem, or null. */
export function shippingProblem(i: ShippingInput): string | null {
  if (!/^\S+\s+\S+/.test(i.name.trim()) || i.name.trim().length > 100) return "Enter a first and last name.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(i.email.trim()) || i.email.length > 200) return "Enter a valid email address.";
  if (!/^\d{7,15}$/.test(digits(i.phone))) return "Enter a phone number with digits only, such as 2065550100.";
  if (!i.line1.trim() || i.line1.length > 120) return "Enter the street address.";
  if (i.line2 && i.line2.length > 120) return "The second address line is too long.";
  if (!i.city.trim() || i.city.length > 80) return "Enter the city.";
  if (!i.state.trim() || i.state.length > 40) return "Enter the state or province.";
  if (!i.postal.trim() || i.postal.length > 20) return "Enter the postal or ZIP code.";
  if (!/^[A-Za-z]{2}$/.test(i.country.trim())) return "Use a two-letter country code, such as US.";
  return null;
}

export async function shippingUpdate(i: ShippingInput): Promise<ShippingProfile> {
  const problem = shippingProblem(i);
  if (problem) throw new ServiceError("SHIPPING_INVALID", problem, 422);
  const args = [
    "shop:shipping", "update", "--name", i.name.trim(), "--email", i.email.trim(), "--phone", digits(i.phone),
    "--line1", i.line1.trim(), "--city", i.city.trim(), "--state", i.state.trim(), "--postal", i.postal.trim(), "--country", i.country.trim().toUpperCase(),
  ];
  if (i.line2?.trim()) args.push("--line2", i.line2.trim());
  return parseShipping((await runKpass(args)).json);
}

/* ---------------------------------- cart ---------------------------------- */

export interface CartLine { externalId: string; title: string; price: string | null; quantity: number }

export function parseCart(json: Record<string, unknown> | null): CartLine[] {
  const items = Array.isArray(json?.["items"]) ? (json["items"] as unknown[]) : [];
  const out: CartLine[] = [];
  for (const raw of items) {
    const it = rec(raw);
    const id = str(it["external_identifier"]);
    const q = num(it["quantity"]);
    if (str(it["provider"]) !== "amazon" || !id || !ASIN.test(id) || q === null || !Number.isInteger(q) || q < 1) continue;
    out.push({ externalId: id, title: str(it["title"]) ?? "", price: parseUsdPrice(it["price"]), quantity: q });
  }
  return out;
}

export async function cartClear(): Promise<void> { await runKpass(["shop:cart", "clear"]); }

export async function cartAdd(externalId: string, quantity: number): Promise<void> {
  if (!ASIN.test(externalId) || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) throw new ServiceError("CART_INVALID", "That item cannot be added.", 422);
  await runKpass(["shop:cart", "add", "--provider", "amazon", "--external-id", externalId, "--quantity", String(quantity)]);
}

export async function cartView(): Promise<CartLine[]> { return parseCart((await runKpass(["shop:cart", "view"])).json); }

/** The USDC the Passport wallet holds in total, as a decimal string, or null when it cannot be read. */
export async function walletUsdc(): Promise<string | null> {
  const r = await runKpass(["wallet", "balance"], [3, 4]);
  const usdc = (Array.isArray(r.json?.["assets"]) ? (r.json!["assets"] as unknown[]) : []).map(rec).find((a) => a["asset"] === "USDC");
  return str(usdc?.["total"]);
}

/* -------------------------------- checkout -------------------------------- */

export type CheckoutFailure = PaidFailure | "in_flight" | "refused";
export type CheckoutResult =
  | { ok: true; orderId: string; providerOrderId: string | null; orderStatus: string; txHash: string | null; totalAmount: string | null; maxTotal: string | null; chain: string | null }
  | { ok: false; kind: CheckoutFailure; code: string | null; message: string };

const fail = (kind: CheckoutFailure, code: string | null, message: string): CheckoutResult => ({ ok: false, kind, code, message });

/** Reads `shop:checkout`. Every documented failure has its own plain message, and "unknown" never reads as "paid". */
export function readCheckoutResult(r: KpassResult): CheckoutResult {
  const code = str(r.json?.["error_code"]);
  if (r.exitCode !== 0) {
    if (code === "shop_checkout_in_flight") return fail("in_flight", code, "The payment was sent but the answer was lost. Check your orders before trying again. The same cart is never charged twice.");
    if (code === "wallet_empty" || code === "insufficient_balance") return fail("wallet_empty", code, "The Passport wallet does not have enough for this order. Nothing was charged.");
    if (code && /^session_(rule|total)_exceeded$|^separate_session_used_up$|^payment_cap_exceeded$/.test(code)) return fail("session_limit", code, "The spending session's limit does not cover this order. Nothing was charged.");
    if (r.exitCode === 3) {
      return /session/i.test(str(r.json?.["error"]) ?? "")
        ? fail("session_unusable", code, "Kite Passport no longer has this session active. Ask for a new spending session. Nothing was charged.")
        : fail("not_signed_in", code, "The Passport account on this server is not signed in.");
    }
    if (code && /^session_/.test(code)) return fail("session_unusable", code, "This spending session cannot be used for this order. Nothing was charged.");
    if (code && /^(checkout_not_confirmed|cart_empty|shipping_incomplete|cart_item_invalid_price|shop_cart_too_large|shop_cart_mixed_retailers)$/.test(code)) {
      return fail("refused", code, str(r.json?.["hint"]) ?? "Kite Passport refused the order before charging. Nothing was charged.");
    }
    if (r.exitCode === 7) return fail("pending", code, "A payment may have gone through and is being checked. Check your orders before trying again.");
    if (r.exitCode === 4 || r.exitCode === 2) {
      const why = str(r.json?.["error"]);
      return fail("refused", code, why ? `The retailer or Passport refused the order: ${why.slice(0, 160)}. Nothing was charged.` : "The order was refused before charging.");
    }
    return fail("failed", code, "Kite Passport could not complete the order. Check your orders before trying again.");
  }
  const orderId = str(r.json?.["order_id"]);
  if (!orderId) return fail("unreadable", null, "Kite Passport answered in a form Procura could not read. Check your orders before trying again.");
  return {
    ok: true, orderId, providerOrderId: str(r.json?.["provider_order_id"]), orderStatus: (str(r.json?.["order_status"]) ?? "pending").toLowerCase(),
    txHash: str(r.json?.["destination_tx_hash"]), totalAmount: str(r.json?.["total_amount"]), maxTotal: str(r.json?.["max_total"]), chain: str(r.json?.["chain"]),
  };
}

/** Places the order. Only call after the person confirmed it and every Procura check passed. */
export async function placeCheckout(input: { sessionId: string; maxTotal: string }): Promise<CheckoutResult> {
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(input.maxTotal)) throw new ServiceError("CHECKOUT_INVALID", "That ceiling is not a valid amount.", 422);
  const r = await runKpass(["shop:checkout", "--confirmed", "--session-id", input.sessionId, "--max-total", input.maxTotal], [1, 2, 3, 4, 6, 7]);
  return readCheckoutResult(r);
}

export interface OrderStatus { orderStatus: string; paymentStatus: string | null; total: string | null; merchantOrderIds: string[]; refundAmount: string | null }

export function parseOrderStatus(json: Record<string, unknown> | null): OrderStatus | null {
  const status = str(json?.["order_status"]);
  if (!status) return null;
  const units = str(rec(json?.["refund_details"])["amount"]);
  // The CLI reports refunds in USDC base units (six decimals).
  const refund = units && /^\d+$/.test(units) ? `${BigInt(units) / 1_000_000n}.${(BigInt(units) % 1_000_000n).toString().padStart(6, "0").slice(0, 2)}` : null;
  return {
    orderStatus: status.toLowerCase(), paymentStatus: str(json?.["payment_status"]), total: str(json?.["total_amount"]),
    merchantOrderIds: (Array.isArray(json?.["merchant_order_ids"]) ? (json!["merchant_order_ids"] as unknown[]) : []).filter((x): x is string => typeof x === "string").slice(0, 10),
    refundAmount: refund,
  };
}

export async function orderStatus(orderId: string): Promise<OrderStatus | null> {
  if (!/^[A-Za-z0-9_-]{4,80}$/.test(orderId)) return null;
  return parseOrderStatus((await runKpass(["shop:order", "status", "--order-id", orderId], [4])).json);
}
