import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AgentExplanationOutputSchema, AgentIntentOutputSchema, type AgentIntentOutput } from "@procura/shared";
import type { ComparisonView } from "@procura/procurement/core";
import { checkExplanation, comparisonFacts, sanitiseIntent } from "../../apps/web/lib/server/agent";
import { limitPerHour } from "../../apps/web/lib/server/rate-limit";
import { jsonSchemaOf, servJson } from "../../apps/web/lib/server/serv";

beforeAll(() => {
  process.env.DATABASE_URL = "postgres://x/y";
  process.env.BETTER_AUTH_SECRET = "test-secret-test-secret-test-secret-123456";
  process.env.SERV_API_KEY = "serv_test_key_do_not_log";
  process.env.SERV_BASE_URL = "https://serv.test";
  process.env.SERV_MODEL = "gpt-5.4-mini";
});
afterEach(() => vi.unstubAllGlobals());

const TODAY = new Date("2026-11-04T10:00:00Z");
const ctx = { defaultCurrency: "USD", today: TODAY };
const intent = (over: Partial<AgentIntentOutput> = {}): AgentIntentOutput => ({
  title: "Kitchen restock",
  items: [{ name: "Basmati rice", quantity: "50", unit: "bags", category: "food" }],
  budgetAmount: "2000", currency: "USD", deliveryLocation: "Lagos", deliveryDeadline: "2026-11-13", priority: "price",
  missingInformation: [], ...over,
});

describe("sanitiseIntent: the model's draft is re-checked, never trusted", () => {
  it("accepts a clean draft", () => {
    const r = sanitiseIntent(intent(), ctx);
    expect(r.draft).toMatchObject({ budgetAmount: "2000", currency: "USD", deliveryDeadline: "2026-11-13", priority: "price" });
    expect(r.draft.items).toEqual([{ productName: "Basmati rice", quantity: "50", unit: "bags", category: "food" }]);
    expect(r.notes).toEqual([]);
  });

  it("drops items with an unclear quantity and refuses a request with nothing buyable", () => {
    const r = sanitiseIntent(intent({ items: [{ name: "Rice", quantity: "50", unit: "bags", category: null }, { name: "Oil", quantity: "a few", unit: "", category: null }] }), ctx);
    expect(r.draft.items.map((i) => i.productName)).toEqual(["Rice"]);
    expect(r.notes.join(" ")).toMatch(/Left out "Oil"/);
    expect(() => sanitiseIntent(intent({ items: [{ name: "Oil", quantity: "0", unit: "l", category: null }] }), ctx)).toThrowError(/anything to buy/);
  });

  it("cleans numbers, rejects non-amounts, and never invents a budget", () => {
    expect(sanitiseIntent(intent({ budgetAmount: "$2,000.50" }), ctx).draft.budgetAmount).toBe("2000.50");
    const bad = sanitiseIntent(intent({ budgetAmount: "about two thousand" }), ctx);
    expect(bad.draft.budgetAmount).toBe("");
    expect(bad.missing).toContain("Budget");
    expect(sanitiseIntent(intent({ budgetAmount: "-5" }), ctx).draft.budgetAmount).toBe("");
    expect(sanitiseIntent(intent({ budgetAmount: null }), ctx).missing).toContain("Budget");
  });

  it("falls back to the business currency and rejects past or impossible dates", () => {
    expect(sanitiseIntent(intent({ currency: null }), ctx).draft.currency).toBe("USD");
    expect(sanitiseIntent(intent({ currency: "ngn" }), ctx).draft.currency).toBe("NGN");
    expect(sanitiseIntent(intent({ currency: "dollars" }), ctx).draft.currency).toBe("USD");
    expect(sanitiseIntent(intent({ deliveryDeadline: "2026-11-01" }), ctx).draft.deliveryDeadline).toBe("");
    expect(sanitiseIntent(intent({ deliveryDeadline: "2026-02-31" }), ctx).draft.deliveryDeadline).toBe("");
    expect(sanitiseIntent(intent({ deliveryDeadline: "next friday" }), ctx).draft.deliveryDeadline).toBe("");
    expect(sanitiseIntent(intent({ deliveryDeadline: "2026-11-04" }), ctx).draft.deliveryDeadline).toBe("2026-11-04");
  });

  it("turns echoed field names into words and ignores optional fields", () => {
    const r = sanitiseIntent(intent({ budgetAmount: null, missingInformation: ["deliveryLocation", "currency", "priority", "supplier"] }), ctx);
    expect(r.missing).toEqual(["Delivery location", "Budget"]);
  });
});

/* A minimal comparison: one eligible recommended quote, one eligible runner-up, one held for review. */
const view = {
  comparison: {
    currency: "USD", recommendedQuoteId: "q1", estimatedSavings: { amount: "100.000000", currency: "USD", basis: "x" }, notes: [],
    rows: [
      { quoteId: "q1", supplierId: "s1", verdict: "eligible", totalCost: "1630.000000", currency: "USD", deliveryDays: 4, rank: 1, deltaVsLowest: "0.000000", eligibility: { reasons: [], missingEvidence: [] } },
      { quoteId: "q2", supplierId: "s2", verdict: "eligible", totalCost: "1730.000000", currency: "USD", deliveryDays: 5, rank: 2, deltaVsLowest: "100.000000", eligibility: { reasons: [], missingEvidence: [] } },
      { quoteId: "q3", supplierId: "s3", verdict: "review_required", totalCost: "1725.000000", currency: "USD", deliveryDays: 3, rank: null, deltaVsLowest: null, eligibility: { reasons: ["CONTACT_NOT_VERIFIED"], missingEvidence: ["contact"] } },
    ],
  },
  suppliers: [{ id: "s1", name: "Meridian", sourceType: "demo" }, { id: "s2", name: "Atlas", sourceType: "demo" }, { id: "s3", name: "PrimeHarvest", sourceType: "demo" }],
  evidence: {
    s1: { identityVerified: true, contactVerified: true, paymentDestinationMatched: true, historicalPerformanceAvailable: true, quotationReceived: true, unresolvedConcerns: [] },
    s3: { identityVerified: true, contactVerified: null, paymentDestinationMatched: null, historicalPerformanceAvailable: false, quotationReceived: true, unresolvedConcerns: [] },
  },
} as unknown as ComparisonView;

const explanation = (preferredQuoteId: string | null) => ({ preferredQuoteId, summary: " ok ", tradeoffs: ["a"], questionsForYou: [] });

describe("the agent may only cite a quote the engine approved", () => {
  it("accepts the recommended quote, an eligible runner-up, or no preference", () => {
    expect(checkExplanation(explanation("q1"), view)).toMatchObject({ preferredSupplier: "Meridian", agreesWithEngine: true, summary: "ok" });
    expect(checkExplanation(explanation("q2"), view)).toMatchObject({ preferredSupplier: "Atlas", agreesWithEngine: false });
    expect(checkExplanation(explanation(null), view)).toMatchObject({ preferredSupplier: null, agreesWithEngine: false });
  });

  it("discards an answer that prefers a held-for-review or unknown quote", () => {
    expect(() => checkExplanation(explanation("q3"), view)).toThrowError(/not eligible/);
    expect(() => checkExplanation(explanation("made-up"), view)).toThrowError(/not eligible/);
  });

  it("shows the model plain facts: tidy amounts, unknown evidence, no internal codes", () => {
    const f = comparisonFacts(view);
    expect(f.quotes[0]).toMatchObject({ supplier: "Meridian", status: "eligible", total_with_delivery: "1630.00 USD" });
    expect(f.quotes[2]).toMatchObject({ status: "held for review", reasons_not_fully_eligible: ["contact not verified"], evidence: { contact: "unknown", payout_address: "unknown", delivery_history: "none yet" } });
    expect(f.estimatedSavings).toBe("100.00");
    expect(JSON.stringify(f)).not.toMatch(/review_required|totalCost/);
  });
});

describe("SERV client", () => {
  const ok = (content: unknown, extra: Record<string, unknown> = {}) =>
    new Response(JSON.stringify({ model: "gpt-5.4-mini-2026", choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }, ...extra }), { status: 200 });
  const run = () => servJson({ name: "intent", system: "sys", user: "hello", schema: AgentIntentOutputSchema });

  it("sends a system prompt, strict json_schema, and a bearer key to the chat completions endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok(intent()));
    vi.stubGlobal("fetch", fetchMock);
    const r = await run();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://serv.test/v1/chat/completions");
    expect(init.headers.authorization).toBe("Bearer serv_test_key_do_not_log");
    const body = JSON.parse(init.body);
    expect(body.messages[0]).toEqual({ role: "system", content: "sys" });
    expect(body.response_format).toMatchObject({ type: "json_schema", json_schema: { name: "intent", strict: true } });
    expect(r.usage).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });
  });

  it("maps upstream failures to safe errors that never contain the key", async () => {
    for (const [status, code] of [[401, "SERV_AUTH"], [404, "SERV_MODEL"], [429, "SERV_RATE_LIMITED"], [500, "SERV_UNAVAILABLE"]] as const) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("upstream says serv_test_key_do_not_log", { status })));
      const err = await run().catch((e: Error) => e);
      expect(err).toMatchObject({ code });
      expect((err as Error).message).not.toMatch(/serv_test_key/);
    }
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("boom")));
    await expect(run()).rejects.toMatchObject({ code: "SERV_UNAVAILABLE" });
  });

  it("fails visibly on refusals, truncation, bad JSON, and output that does not match the schema", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: null, refusal: "no" } }] }))));
    await expect(run()).rejects.toMatchObject({ code: "SERV_REFUSED" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ finish_reason: "length", message: { content: "{" } }] }))));
    await expect(run()).rejects.toMatchObject({ code: "SERV_BAD_OUTPUT" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "not json" } }] }))));
    await expect(run()).rejects.toMatchObject({ code: "SERV_BAD_OUTPUT" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok({ title: "only a title" })));
    await expect(run()).rejects.toMatchObject({ code: "SERV_BAD_OUTPUT" });
  });

  it("reports not-connected when there is no key", async () => {
    const key = process.env.SERV_API_KEY;
    delete process.env.SERV_API_KEY;
    vi.resetModules();
    const fresh = await import("../../apps/web/lib/server/serv");
    await expect(fresh.servJson({ name: "x", system: "s", user: "u", schema: AgentIntentOutputSchema })).rejects.toMatchObject({ code: "SERV_NOT_CONFIGURED" });
    process.env.SERV_API_KEY = key;
  });
});

describe("structured-output schemas are strict-mode compatible", () => {
  /** OpenAI strict mode: every object lists all its properties as required and forbids extras. */
  function check(node: unknown, path = "root"): void {
    if (!node || typeof node !== "object") return;
    const n = node as Record<string, unknown>;
    if (n["type"] === "object") {
      const props = Object.keys((n["properties"] as object) ?? {});
      expect(n["additionalProperties"], `${path} additionalProperties`).toBe(false);
      expect([...((n["required"] as string[]) ?? [])].sort(), `${path} required`).toEqual([...props].sort());
    }
    for (const [k, v] of Object.entries(n)) check(v, `${path}.${k}`);
  }
  it.each([["intent", AgentIntentOutputSchema], ["explanation", AgentExplanationOutputSchema]])("%s", (_n, schema) => check(jsonSchemaOf(schema)));
});

describe("agent rate limit", () => {
  it("allows up to the cap per hour and then refuses, and recovers after the window", () => {
    const t = Date.now();
    for (let i = 0; i < 3; i++) limitPerHour("u1", 3, t + i);
    expect(() => limitPerHour("u1", 3, t + 10)).toThrowError(/a lot/);
    expect(() => limitPerHour("u2", 3, t + 10)).not.toThrow();
    expect(() => limitPerHour("u1", 3, t + 3_600_100)).not.toThrow();
  });
});
