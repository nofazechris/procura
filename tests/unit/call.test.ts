import { beforeAll, describe, expect, it } from "vitest";
import { ServiceError } from "@procura/shared";
import { sanitiseCallScript } from "../../apps/web/lib/server/agent";

beforeAll(() => {
  process.env.DATABASE_URL = "postgres://x/y";
  process.env.BETTER_AUTH_SECRET = "test-secret-test-secret-test-secret-123456";
});

const draft = {
  opening: "Hello, I am an AI assistant calling for a customer.",
  questions: ["What is the price for 50 bags?", "Is it in stock?", "How long is delivery?"],
  mustConfirm: ["The quoted total", "The delivery date"],
  closing: "Thank you.",
};

describe("call script safety", () => {
  it("keeps a clean script as it is", () => {
    const s = sanitiseCallScript(draft);
    expect(s.questions).toHaveLength(3);
    expect(s.notes).toEqual([]);
  });

  it("drops any line that promises or asks for payment, and says so", () => {
    const s = sanitiseCallScript({
      ...draft,
      questions: [...draft.questions, "We will pay a deposit today.", "Can you send your account number?", "I will buy it now."],
      closing: "I can pay by wire right away.",
    });
    expect(s.questions).toEqual(draft.questions);
    expect(s.closing).toMatch(/pass this on/i);
    expect(s.notes.length).toBe(4);
  });

  it("caps the number and length of lines", () => {
    const many = Array.from({ length: 12 }, (_, i) => `Question ${i} ${"x".repeat(400)}`);
    const s = sanitiseCallScript({ ...draft, questions: many });
    expect(s.questions).toHaveLength(6);
    expect(s.questions.every((q) => q.length <= 240)).toBe(true);
  });

  it("refuses a script with nothing usable to ask", () => {
    expect(() => sanitiseCallScript({ ...draft, questions: ["", "I will pay now."] })).toThrow(ServiceError);
  });

  it("always opens as an AI when the model leaves it blank", () => {
    expect(sanitiseCallScript({ ...draft, opening: "" }).opening).toMatch(/AI assistant/);
  });
});
