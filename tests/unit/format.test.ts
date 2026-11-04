import { describe, expect, it } from "vitest";
import { amount, minus, money, moneyShort, initials, shortAddress } from "../../apps/web/lib/format";

describe("display formatting", () => {
  it("formats exact decimals from the API's six-place strings", () => {
    expect(amount("1630.000000")).toBe("1,630.00");
    expect(amount("14820")).toBe("14,820.00");
    expect(amount("0.1")).toBe("0.10");
    expect(amount("1234567.891234", 2)).toBe("1,234,567.89");
  });

  it("shows the currency every time", () => {
    expect(money("1630.000000", "USD")).toBe("$1,630.00");
    expect(money("1630", "USDC.e")).toBe("1,630.00 USDC.e");
    expect(moneyShort("1630.000000", "USD")).toBe("$1,630");
    expect(moneyShort("1630.50", "USD")).toBe("$1,630.50");
  });

  it("does exact subtraction where floats go wrong", () => {
    expect(minus("0.3", "0.1")).toBe("0.200000");
    expect(minus("2000.000000", "1630.000000")).toBe("370.000000");
    expect(minus("100", "250.5")).toBe("-150.500000");
  });

  it("falls back safely on empty and invalid values", () => {
    expect(amount(null)).toBe("-");
    expect(amount("")).toBe("-");
    expect(amount("not a number")).toBe("not a number");
  });

  it("builds initials and short addresses", () => {
    expect(initials("Chris Godwin")).toBe("CG");
    expect(initials("Madonna")).toBe("M");
    expect(shortAddress("0xDe30000000000000000000000000000000000002")).toBe("0xDe30…0002");
  });
});
