import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { affordableCheckout, amazonCheckoutLimits } from "@procura/policies/core";
import {
  AI_DISCLOSURE, buildCallBody, buildCallTask, CALL_MAX_MINUTES, isCallUrl, parseCallStarted, parseCallStatus, phoneHint, toE164,
} from "@procura/procurement";
import { setKpassExecutor, type KpassResult } from "../../apps/web/lib/server/passport";
import {
  cartAdd, parseCart, parseOrderStatus, parseShipping, placeCheckout, readCheckoutResult, shippingProblem, shippingUpdate,
} from "../../apps/web/lib/server/passport-shop";

beforeAll(() => {
  process.env.DATABASE_URL = "postgres://x/y";
  process.env.BETTER_AUTH_SECRET = "test-secret-test-secret-test-secret-123456";
  process.env.PASSPORT_HOME = "C:/tmp/passport";
});
afterEach(() => setKpassExecutor());

describe("what a wallet can afford", () => {
  it("uses the usual cap when the wallet covers it", () => {
    const a = affordableCheckout("10.00", "50.00");
    expect(a).toMatchObject({ ok: true, tightened: false });
    expect(a.limits).toMatchObject({ cap: "15.00", charge: "16.00" });
  });

  it("with $4, lowers the ceiling to what the wallet can hold, never below the items", () => {
    const a = affordableCheckout("2.50", "4.00");
    expect(a).toMatchObject({ ok: true, tightened: true });
    expect(a.limits).toMatchObject({ subtotal: "2.50", cap: "3.00", charge: "4.00" });
  });

  it("says how much more is needed when the wallet cannot cover the items plus the fee", () => {
    const a = affordableCheckout("3.50", "4.00");
    expect(a).toMatchObject({ ok: false, shortBy: "0.50", limits: null });
  });

  it("refuses a ceiling below the price of the items", () => {
    expect(() => amazonCheckoutLimits("10.00", "9.99")).toThrow();
    expect(amazonCheckoutLimits("10.00", "10.00")).toMatchObject({ cap: "10.00", charge: "11.00" });
  });
});

describe("phone calls", () => {
  it("accepts only international numbers and cleans their formatting", () => {
    expect(toE164("+234 801 234 5678")).toBe("+2348012345678");
    expect(toE164("+1 (415) 555-1234")).toBe("+14155551234");
    for (const bad of ["08012345678", "415 555 1234", "+0123456789", "+12", "+1234567890123456", "", null, undefined, "+1415abc5551"]) expect(toE164(bad as string), String(bad)).toBeNull();
    expect(phoneHint("+2348012345678")).toBe("ending 5678");
  });

  it("every call opens as an AI, only asks, is not recorded and has a time limit", () => {
    const body = buildCallBody("+2348012345678", "Ikeja Office Supply", { opening: "Hi!", questions: ["How much?", "In stock?"], mustConfirm: ["the total"], closing: "Thanks." });
    expect(body).toMatchObject({ phone_number: "+2348012345678", first_sentence: AI_DISCLOSURE, record: false, max_duration: CALL_MAX_MINUTES, voicemail_action: "hangup" });
    const task = String(body["task"]);
    expect(task).toMatch(/AI assistant/i);
    expect(task).toMatch(/never agree to buy/i);
    expect(task).toMatch(/never give card, bank or account details/i);
    expect(task.indexOf("never agree")).toBeLessThan(task.indexOf("How much?"));
  });

  it("a hostile seller name or script cannot remove the safety rules or grow the task without bound", () => {
    const task = buildCallTask("X".repeat(500), { opening: "o", questions: ["q".repeat(5000)], mustConfirm: [], closing: "c" });
    expect(task.length).toBeLessThanOrEqual(3000);
    expect(task).toMatch(/never agree to buy/i);
  });

  it("only talks to StablePhone's call endpoints", () => {
    expect(isCallUrl("https://stablephone.dev/api/call")).toBe(true);
    expect(isCallUrl("https://stablephone.dev/api/call/abc-123")).toBe(true);
    for (const bad of ["http://stablephone.dev/api/call", "https://stablephone.dev.evil.example/api/call", "https://stablephone.dev/api/number", "https://stablephone.dev/api/call/../number"]) expect(isCallUrl(bad), bad).toBe(false);
  });

  it("a call is placed only on a clear success with a call id", () => {
    expect(parseCallStarted({ success: true, call_id: "abc-123", message: "Call initiated" })).toEqual({ callId: "abc-123" });
    for (const bad of [null, {}, { success: false, call_id: "x" }, { success: true }, { success: true, call_id: "a b" }, { success: true, call_id: 5 }]) expect(parseCallStarted(bad)).toBeNull();
  });

  it("reads call progress defensively and caps untrusted text", () => {
    const s = parseCallStatus({ status: "Completed", completed: true, answered_by: "human", call_length: 1.5, summary: "S".repeat(5000), transcript: "T".repeat(10000), error_message: null });
    expect(s).toMatchObject({ status: "completed", completed: true, answeredBy: "human", seconds: 90 });
    expect(s!.summary!.length).toBe(1500);
    expect(s!.transcript!.length).toBe(6000);
    expect(parseCallStatus({})).toBeNull();
    expect(parseCallStatus({ status: "in-progress", call_length: -4 })).toMatchObject({ completed: false, seconds: null });
  });
});

describe("delivery details", () => {
  const good = { name: "Jane Doe", email: "jane@example.com", phone: "(206) 555-0100", line1: "456 Oak Ave", city: "Austin", state: "TX", postal: "78701", country: "us" };

  it("accepts good details and explains the first problem otherwise", () => {
    expect(shippingProblem(good)).toBeNull();
    expect(shippingProblem({ ...good, name: "Jane" })).toMatch(/first and last/i);
    expect(shippingProblem({ ...good, email: "nope" })).toMatch(/email/i);
    expect(shippingProblem({ ...good, phone: "12" })).toMatch(/phone/i);
    expect(shippingProblem({ ...good, country: "USA" })).toMatch(/two-letter/i);
    expect(shippingProblem({ ...good, line1: "" })).toMatch(/street/i);
  });

  it("passes details as separate arguments, never through a shell, with the phone as digits only", async () => {
    let seen: string[] = [];
    setKpassExecutor(async (args) => { seen = args; return { exitCode: 0, json: { name: "Jane Doe", missing: [], complete: true } }; });
    await shippingUpdate({ ...good, line1: "1 Main St; rm -rf /" });
    expect(seen[seen.indexOf("--line1") + 1]).toBe("1 Main St; rm -rf /");
    expect(seen[seen.indexOf("--phone") + 1]).toBe("2065550100");
    expect(seen[seen.indexOf("--country") + 1]).toBe("US");
  });

  it("a profile only counts as complete when it says so and nothing is missing", () => {
    expect(parseShipping({ complete: true, missing: [] }).complete).toBe(true);
    expect(parseShipping({ complete: true, missing: ["phone"] }).complete).toBe(false);
    expect(parseShipping({ missing: [] }).complete).toBe(false);
    expect(parseShipping(null).complete).toBe(false);
  });
});

describe("the cart and the checkout", () => {
  it("reads only well-formed Amazon lines with a clear price", () => {
    const cart = parseCart({ items: [
      { provider: "amazon", external_identifier: "B0CXYYWL6G", title: "Coffee", price: "$12.49", quantity: 2 },
      { provider: "ebay", external_identifier: "B0CXYYWL6G", price: "$1.00", quantity: 1 },
      { provider: "amazon", external_identifier: "bad", price: "$1.00", quantity: 1 },
      { provider: "amazon", external_identifier: "B0CXYYWL6H", price: "$5 to $9", quantity: 1 },
      { provider: "amazon", external_identifier: "B0CXYYWL6J", price: "$3.00", quantity: 0 },
    ] });
    expect(cart.map((c) => [c.externalId, c.price, c.quantity])).toEqual([["B0CXYYWL6G", "12.49", 2], ["B0CXYYWL6H", null, 1]]);
  });

  it("only adds a real product id, in a sensible quantity", async () => {
    await expect(cartAdd("../etc/passwd", 1)).rejects.toThrow();
    await expect(cartAdd("B0CXYYWL6G", 0)).rejects.toThrow();
    await expect(cartAdd("B0CXYYWL6G", 500)).rejects.toThrow();
  });

  it("confirms, names the session and the ceiling, and never uses the allowance", async () => {
    let seen: string[] = [];
    setKpassExecutor(async (args) => { seen = args; return { exitCode: 0, json: { order_id: "ord_1", order_status: "pending", destination_tx_hash: "0xabc", total_amount: "$7.00", chain: "base" } }; });
    const r = await placeCheckout({ sessionId: "sess_1", maxTotal: "6.00" });
    expect(r).toMatchObject({ ok: true, orderId: "ord_1", orderStatus: "pending", txHash: "0xabc" });
    expect(seen.slice(0, 2)).toEqual(["shop:checkout", "--confirmed"]);
    expect(seen).toEqual(expect.arrayContaining(["--session-id", "sess_1", "--max-total", "6.00"]));
    expect(seen).not.toContain("--use-allowance");
    await expect(placeCheckout({ sessionId: "s", maxTotal: "1e9" })).rejects.toThrow();
  });

  it("each failure has its own plain answer, and an unknown outcome never reads as paid", () => {
    const k = (exitCode: number, json: Record<string, unknown> | null): KpassResult => ({ exitCode, json });
    expect(readCheckoutResult(k(6, { error_code: "wallet_empty" }))).toMatchObject({ ok: false, kind: "wallet_empty" });
    expect(readCheckoutResult(k(6, { error_code: "session_rule_exceeded" }))).toMatchObject({ kind: "session_limit" });
    expect(readCheckoutResult(k(3, { error: "No active session found for the given session ID." }))).toMatchObject({ kind: "session_unusable" });
    expect(readCheckoutResult(k(3, { error: "Not logged in" }))).toMatchObject({ kind: "not_signed_in" });
    expect(readCheckoutResult(k(1, { error_code: "shop_checkout_in_flight" }))).toMatchObject({ kind: "in_flight" });
    expect(readCheckoutResult(k(2, { error_code: "cart_empty", hint: "Cart is empty." }))).toMatchObject({ kind: "refused" });
    expect(readCheckoutResult(k(7, { error_code: "payment_outcome_pending" }))).toMatchObject({ kind: "pending" });
    expect(readCheckoutResult(k(0, {}))).toMatchObject({ ok: false, kind: "unreadable" });
    expect(readCheckoutResult(k(1, null))).toMatchObject({ ok: false, kind: "failed" });
  });

  it("reads an order's status and its refund in dollars", () => {
    const s = parseOrderStatus({ order_status: "Completed", payment_status: "settled", total_amount: "$15.49", merchant_order_ids: ["113-1234567-1234567"], refund_details: { amount: "3000000" } });
    expect(s).toMatchObject({ orderStatus: "completed", paymentStatus: "settled", refundAmount: "3.00", merchantOrderIds: ["113-1234567-1234567"] });
    expect(parseOrderStatus({})).toBeNull();
  });
});
