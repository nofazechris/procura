import { describe, expect, it } from "vitest";
import { add, compare, formatMoney, fromUnits, money, MoneyError, multiply, subtract, sum, toUnits } from "@procura/shared";

describe("money", () => {
  it("does exact decimal arithmetic where floats fail", () => {
    // 0.1 + 0.2 !== 0.3 in IEEE floats
    expect(add(money("0.10", "USD"), money("0.20", "USD")).amount).toBe("0.30");
    expect(sum([money("1580.00", "USD"), money("50.00", "USD")], "USD").amount).toBe("1630.00");
  });

  it("matches the demo comparison totals", () => {
    expect(add(money("1650", "USD"), money("80", "USD")).amount).toBe("1730.00");
    expect(add(money("1700", "USD"), money("25", "USD")).amount).toBe("1725.00");
  });

  it("refuses to combine or compare different currencies", () => {
    expect(() => add(money("1", "USD"), money("1", "USDC.e"))).toThrow(MoneyError);
    expect(() => compare(money("1", "USD"), money("1", "NGN"))).toThrow(/Currency mismatch/);
    expect(() => subtract(money("5", "USD"), money("1", "EUR"))).toThrow(MoneyError);
  });

  it("rejects malformed and over-precise amounts instead of rounding silently", () => {
    expect(() => toUnits("12,50")).toThrow(MoneyError);
    expect(() => toUnits("abc")).toThrow(MoneyError);
    expect(() => toUnits("1.1234567")).toThrow(/decimal places/);
    expect(() => money("1e3", "USD")).toThrow(MoneyError);
  });

  it("multiplies unit price by quantity exactly, including fractional quantities", () => {
    expect(multiply(money("23.00", "USD"), "50").amount).toBe("1150.00");
    expect(multiply(money("14.50", "USD"), "20").amount).toBe("290.00");
    expect(multiply(money("3.20", "USD"), "2.5").amount).toBe("8.00");
  });

  it("rounds half up when reducing to 2 places", () => {
    expect(fromUnits(toUnits("1.005"), 6, 2)).toBe("1.01");
    expect(fromUnits(toUnits("1.004"), 6, 2)).toBe("1.00");
    expect(fromUnits(toUnits("0.999999"), 6, 2)).toBe("1.00");
  });

  it("handles negatives and subtraction", () => {
    expect(subtract(money("100", "USD"), money("250.50", "USD")).amount).toBe("-150.50");
  });

  it("compares", () => {
    expect(compare(money("2000", "USD"), money("1630", "USD"))).toBe(1);
    expect(compare(money("1630", "USD"), money("1630.00", "USD"))).toBe(0);
  });

  it("formats with grouping and the currency code", () => {
    expect(formatMoney(money("14820", "USD"))).toBe("14,820.00 USD");
    expect(formatMoney(money("1630.5", "USDC.e"))).toBe("1,630.50 USDC.e");
  });
});
