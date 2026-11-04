import type { LandingData } from "@/lib/landing/data";

/** Chapter windows on the scroll progress (0 to 1). The 3D scene uses the same boundaries. */
export const CHAPTER_EDGES = [0, 0.09, 0.22, 0.36, 0.5, 0.64, 0.78, 0.9, 1] as const;

export interface Chapter {
  /** Short numbered label above the headline. */
  kicker: string;
  headline: string;
  /** One line of real data, shown in the mono face. */
  data: string;
  body: string;
}

const usd = (v: string, places = 0) => `$${Number(v).toLocaleString("en-US", { minimumFractionDigits: places, maximumFractionDigits: places })}`;
const two = (v: string) => usd(v, 2);

/** Every figure comes from the engine run in lib/landing/data.ts. */
export function buildChapters(d: LandingData): Chapter[] {
  const eligible = d.options.filter((o) => o.verdict === "eligible");
  const held = d.options.filter((o) => o.verdict === "review_required");
  const rec = d.options.find((o) => o.id === d.recommendedId)!;
  const totals = d.options.map((o) => two(o.total)).join("  ·  ");
  return [
    {
      kicker: "A safe AI buyer",
      headline: "An AI buyer that cannot overspend.",
      data: "find  ·  prove  ·  compare  ·  you approve  ·  capped payment",
      body: "The agent does the research and the buying. Kite Passport enforces how much it can spend, and a person approves every purchase.",
    },
    {
      kicker: "01  Instruct",
      headline: "Tell it what you need.",
      data: `${d.request.items.map((i) => `${i.quantity} ${i.name.toLowerCase()}`).join("  ·  ")}  ·  ${usd(d.request.budget)} budget`,
      body: "Describe the purchase in plain words. The agent turns it into one structured request, and you review it before anything runs.",
    },
    {
      kicker: "02  Find",
      headline: "It looks where you cannot.",
      data: `live Amazon search  ·  ${d.options.length} options  ·  sample catalogue`,
      body: "The agent searches real listings through Kite Passport. Searching is free and buys nothing. It builds comparable baskets, with the actual product behind every line.",
    },
    {
      kicker: "03  Prove",
      headline: "Evidence, or it does not count.",
      data: `${eligible.length} ready  ·  ${held.length} held for review`,
      body: "A cheaper supplier whose contact and payout details are unverified is held for review, not recommended. Unknown is never shown as verified.",
    },
    {
      kicker: "04  Compare",
      headline: "Cheapest is not the only test.",
      data: `${totals}  ·  ${usd(d.request.budget)} budget`,
      body: "A deterministic filter decides who is eligible before anything is ranked. Over budget is out. Savings are estimates, never claimed as realised.",
    },
    {
      kicker: "05  Order",
      headline: "Every total, recalculated.",
      data: `${two(d.order.subtotal)} before shipping and tax`,
      body: "Totals come from unit prices on the server, never from a form or a model. The order is sealed with a fingerprint of everything payable.",
    },
    {
      kicker: "06  Approve",
      headline: "Your key, every time.",
      data: `session ${two(d.session.budget)}  ·  cap ${two(d.session.cap)} + $1 fee  ·  ${d.session.minutes} min`,
      body: "Nothing moves until you approve with your passkey. The agent cannot raise its limits, change the basket or edit an approved order.",
    },
    {
      kicker: "07  Pay",
      headline: "Spent inside the cap, never past it.",
      data: `${rec.name}  ·  paid inside the approved session`,
      body: "Kite Passport enforces the cap and refunds what the order did not use. Checkout is the next step to go live, so every figure here comes from a fictional sample.",
    },
  ];
}

/** The live ledger in the corner: each line becomes known at a chapter. */
export interface LedgerLine { label: string; value: string; from: number }

export function buildLedger(d: LandingData): LedgerLine[] {
  const eligible = d.options.filter((o) => o.verdict === "eligible").length;
  const rec = d.options.find((o) => o.id === d.recommendedId)!;
  return [
    { label: "request", value: d.request.number, from: 1 },
    { label: "options", value: String(d.options.length), from: 2 },
    { label: "eligible", value: `${eligible} of ${d.options.length}`, from: 3 },
    { label: "total", value: `${two(rec.total)} + ship`, from: 4 },
    { label: "order", value: d.order.number, from: 5 },
    { label: "fingerprint", value: `${d.order.fingerprint.slice(0, 10)}…`, from: 5 },
    { label: "approval", value: "your passkey", from: 6 },
    { label: "status", value: "inside the cap", from: 7 },
  ];
}
