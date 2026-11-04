import { describe, expect, it } from "vitest";
import {
  assertPaymentTransition, canTransitionPayment, canTransitionPurchaseOrder, canTransitionRequest,
  canTransitionSession, InvalidTransitionError, PAYMENT_STATUSES,
} from "@procura/shared";

describe("payment state machine", () => {
  it("only lets a payment be confirmed after it was submitted or pending", () => {
    for (const from of PAYMENT_STATUSES) {
      const allowed = canTransitionPayment(from, "confirmed");
      expect(allowed).toBe(from === "submitted" || from === "pending");
    }
  });

  it("can never skip from prepared or authorised straight to confirmed", () => {
    expect(() => assertPaymentTransition("prepared", "confirmed")).toThrow(InvalidTransitionError);
    expect(() => assertPaymentTransition("authorised", "confirmed")).toThrow(InvalidTransitionError);
  });

  it("treats confirmed, failed and cancelled as terminal", () => {
    for (const s of ["confirmed", "failed", "cancelled"] as const) {
      for (const to of PAYMENT_STATUSES) expect(canTransitionPayment(s, to)).toBe(false);
    }
  });

  it("allows polling an unresolved payment", () => {
    expect(canTransitionPayment("pending", "pending")).toBe(true);
  });
});

describe("other lifecycles", () => {
  it("purchase orders cannot become paid without going through payment_pending", () => {
    expect(canTransitionPurchaseOrder("awaiting_payment", "paid")).toBe(false);
    expect(canTransitionPurchaseOrder("payment_pending", "paid")).toBe(true);
    expect(canTransitionPurchaseOrder("draft", "paid")).toBe(false);
  });

  it("requests cannot be completed straight from sourcing", () => {
    expect(canTransitionRequest("sourcing", "completed")).toBe(false);
    expect(canTransitionRequest("processing", "completed")).toBe(true);
  });

  it("an expired or revoked session cannot be reactivated", () => {
    expect(canTransitionSession("expired", "active")).toBe(false);
    expect(canTransitionSession("revoked", "active")).toBe(false);
    expect(canTransitionSession("awaiting_user_approval", "active")).toBe(true);
  });
});
