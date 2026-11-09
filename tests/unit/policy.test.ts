import { describe, expect, it } from "vitest";
import {
  evaluateOrderPolicy, evaluatePaymentExecution, orderFingerprint,
  type ExecutionInput, type SpendingPolicy,
} from "@procura/policies";
import { money } from "@procura/shared";

const SUPPLIER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

const policy: SpendingPolicy = {
  currency: "USD",
  maxTotalSpend: "20000.00",
  maxTransactionAmount: "2500.00",
  approvalRequired: false,
  approvalRequiredAbove: "500.00",
  approvedSupplierIds: [],
  restrictedSupplierIds: [],
  allowedCategories: [],
  restrictedCategories: [],
};

const order = { supplierId: SUPPLIER, total: money("1630.00", "USD"), categories: ["food"] };

describe("evaluateOrderPolicy", () => {
  it("allows the sample order and reports why", () => {
    const d = evaluateOrderPolicy(policy, order, "14820.00");
    expect(d.allowed).toBe(true);
    expect(d.requiresApproval).toBe(true); // 1630 > 500 threshold
    expect(d.reasonCodes).toEqual(expect.arrayContaining([
      "WITHIN_BUSINESS_BUDGET", "WITHIN_TRANSACTION_LIMIT", "SUPPLIER_ALLOWED", "PASSPORT_SESSION_REQUIRED",
    ]));
    expect(d.maxAllowedAmount).toBe("2500.00");
  });

  it("rejects an order that would exceed the business budget, using exact arithmetic", () => {
    const d = evaluateOrderPolicy(policy, order, "18370.01"); // 18370.01 + 1630 = 20000.01
    expect(d.allowed).toBe(false);
    expect(d.reasonCodes).toContain("EXCEEDS_BUSINESS_BUDGET");
    expect(evaluateOrderPolicy(policy, order, "18370.00").allowed).toBe(true); // exactly 20000.00
  });

  it("caps maxAllowedAmount at the remaining budget when that is lower than the tx limit", () => {
    const d = evaluateOrderPolicy(policy, order, "19000.00");
    expect(d.maxAllowedAmount).toBe("1000.00");
  });

  it("rejects an order above the per-transaction limit", () => {
    const d = evaluateOrderPolicy(policy, { ...order, total: money("2500.01", "USD") }, "0");
    expect(d.allowed).toBe(false);
    expect(d.reasonCodes).toContain("EXCEEDS_TRANSACTION_LIMIT");
  });

  it("blocks restricted suppliers and suppliers outside an allow-list", () => {
    const restricted = evaluateOrderPolicy({ ...policy, restrictedSupplierIds: [SUPPLIER] }, order, "0");
    expect(restricted.allowed).toBe(false);
    expect(restricted.reasonCodes).toContain("SUPPLIER_RESTRICTED");

    const notListed = evaluateOrderPolicy({ ...policy, approvedSupplierIds: [OTHER] }, order, "0");
    expect(notListed.allowed).toBe(false);
    expect(notListed.reasonCodes).toContain("SUPPLIER_NOT_APPROVED");
  });

  it("restricts categories and enforces category allow-lists", () => {
    expect(evaluateOrderPolicy({ ...policy, restrictedCategories: ["food"] }, order, "0").reasonCodes)
      .toContain("CATEGORY_RESTRICTED");
    expect(evaluateOrderPolicy({ ...policy, allowedCategories: ["packaging"] }, order, "0").reasonCodes)
      .toContain("CATEGORY_NOT_ALLOWED");
  });

  it("never compares across currencies", () => {
    const d = evaluateOrderPolicy(policy, { ...order, total: money("1630.00", "NGN") }, "0");
    expect(d.allowed).toBe(false);
    expect(d.reasonCodes).toEqual(["CURRENCY_MISMATCH"]);
  });

  it("requires approval for every order when no threshold is configured", () => {
    const d = evaluateOrderPolicy({ ...policy, approvalRequiredAbove: null }, { ...order, total: money("10.00", "USD") }, "0");
    expect(d.requiresApproval).toBe(true);
  });
});

/* ------------------------------------------------------------------ */

const ADDR = "0x7Af3000000000000000000000000000000009e21";
const items = [{ description: "Rice", quantity: "50", unitPrice: "23.00", totalPrice: "1150.00" }];
const fpInput = {
  supplierId: SUPPLIER, currency: "USD", paymentAsset: "USDC.e", recipientAddress: ADDR,
  subtotal: "1580.00", deliveryCost: "50.00", totalAmount: "1630.00", items,
};
const fingerprint = orderFingerprint(fpInput);
const now = new Date("2026-11-03T09:50:00Z");

function goodExecution(over: Partial<ExecutionInput> = {}): ExecutionInput {
  return {
    now,
    amount: money("1630.00", "USDC.e"),
    recipientAddress: ADDR,
    approvedRecipientAddress: ADDR,
    supplierRestricted: false,
    session: {
      status: "active", asset: "USDC.e", remainingAmount: "2000.00", maxPerTransaction: "2500.00",
      expiresAt: new Date("2026-11-03T10:20:00Z"),
    },
    userApprovalRecorded: true,
    approvedOrderFingerprint: fingerprint,
    currentOrderFingerprint: fingerprint,
    paymentAlreadyExecuted: false,
    supportedAssets: ["USDC.e"],
    orderPolicy: evaluateOrderPolicy(policy, order, "0"),
    ...over,
  };
}

describe("evaluatePaymentExecution (hard restrictions)", () => {
  it("permits a fully valid payment", () => {
    expect(evaluatePaymentExecution(goodExecution())).toEqual({ allowed: true, rejections: [] });
  });

  it("refuses without recorded user approval", () => {
    const d = evaluatePaymentExecution(goodExecution({ userApprovalRecorded: false }));
    expect(d.allowed).toBe(false);
    expect(d.rejections).toContain("USER_APPROVAL_MISSING");
  });

  it("refuses when there is no session, or it is not active, or it has expired", () => {
    expect(evaluatePaymentExecution(goodExecution({ session: null })).rejections).toContain("SESSION_MISSING");
    const pending = goodExecution();
    pending.session = { ...pending.session!, status: "awaiting_user_approval" };
    expect(evaluatePaymentExecution(pending).rejections).toContain("SESSION_NOT_ACTIVE");
    const expired = goodExecution();
    expired.session = { ...expired.session!, expiresAt: new Date("2026-11-03T09:50:00Z") };
    expect(evaluatePaymentExecution(expired).rejections).toContain("SESSION_EXPIRED");
  });

  it("refuses when the session budget or per-transaction limit cannot cover the amount", () => {
    const low = goodExecution();
    low.session = { ...low.session!, remainingAmount: "1629.99" };
    expect(evaluatePaymentExecution(low).rejections).toContain("SESSION_BUDGET_INSUFFICIENT");
    const cap = goodExecution();
    cap.session = { ...cap.session!, maxPerTransaction: "1000.00" };
    expect(evaluatePaymentExecution(cap).rejections).toContain("SESSION_TX_LIMIT_EXCEEDED");
  });

  it("refuses a recipient that is unapproved or differs from the approved destination", () => {
    expect(evaluatePaymentExecution(goodExecution({ approvedRecipientAddress: null })).rejections)
      .toContain("RECIPIENT_NOT_APPROVED");
    const swapped = "0xBAD0000000000000000000000000000000000001";
    expect(evaluatePaymentExecution(goodExecution({ recipientAddress: swapped })).rejections)
      .toContain("RECIPIENT_MISMATCH");
  });

  it("treats addresses case-insensitively", () => {
    expect(evaluatePaymentExecution(goodExecution({ recipientAddress: ADDR.toUpperCase().replace("0X", "0x") })).allowed)
      .toBe(true);
  });

  it("refuses when the purchase order changed after approval", () => {
    const changed = orderFingerprint({ ...fpInput, totalAmount: "1630.01" });
    expect(evaluatePaymentExecution(goodExecution({ currentOrderFingerprint: changed })).rejections)
      .toContain("ORDER_CHANGED_AFTER_APPROVAL");
    expect(evaluatePaymentExecution(goodExecution({ approvedOrderFingerprint: null })).rejections)
      .toContain("ORDER_CHANGED_AFTER_APPROVAL");
  });

  it("refuses a duplicate payment, an unsupported asset, and restricted suppliers", () => {
    expect(evaluatePaymentExecution(goodExecution({ paymentAlreadyExecuted: true })).rejections).toContain("DUPLICATE_PAYMENT");
    expect(evaluatePaymentExecution(goodExecution({ amount: money("1630.00", "USD") })).rejections).toContain("UNSUPPORTED_ASSET");
    expect(evaluatePaymentExecution(goodExecution({ supplierRestricted: true })).rejections).toContain("SUPPLIER_RESTRICTED");
  });

  it("refuses when the business policy no longer allows the order", () => {
    const blocked = evaluateOrderPolicy({ ...policy, restrictedSupplierIds: [SUPPLIER] }, order, "0");
    expect(evaluatePaymentExecution(goodExecution({ orderPolicy: blocked })).rejections).toContain("POLICY_NOT_ALLOWED");
  });

  it("reports every violation, not just the first", () => {
    const d = evaluatePaymentExecution(goodExecution({ session: null, userApprovalRecorded: false, paymentAlreadyExecuted: true }));
    expect(d.rejections).toEqual(expect.arrayContaining(["SESSION_MISSING", "USER_APPROVAL_MISSING", "DUPLICATE_PAYMENT"]));
  });
});

describe("orderFingerprint", () => {
  it("is stable and ignores line-item order and address case", () => {
    const two = [...items, { description: "Oil", quantity: "20", unitPrice: "14.50", totalPrice: "290.00" }];
    const a = orderFingerprint({ ...fpInput, items: two });
    const b = orderFingerprint({ ...fpInput, items: [...two].reverse(), recipientAddress: ADDR.toUpperCase().replace("0X", "0x") });
    expect(a).toBe(b);
  });

  it("changes when any payable detail changes", () => {
    expect(orderFingerprint({ ...fpInput, recipientAddress: "0xBAD0000000000000000000000000000000000001" })).not.toBe(fingerprint);
    expect(orderFingerprint({ ...fpInput, items: [{ ...items[0]!, quantity: "51" }] })).not.toBe(fingerprint);
  });
});
