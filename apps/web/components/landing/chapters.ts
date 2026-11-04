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

/** Every figure comes from the engine run in lib/landing/data.ts. */
export function buildChapters(d: LandingData): Chapter[] {
  const eligible = d.suppliers.filter((s) => s.verdict === "eligible");
  const review = d.suppliers.filter((s) => s.verdict !== "eligible");
  const rec = d.suppliers.find((s) => s.id === d.recommendedId)!;
  const totals = d.suppliers.map((s) => usd(s.total)).join("  ·  ");
  return [
    {
      kicker: "Autonomous procurement",
      headline: "Procurement, on autopilot.",
      data: "agents source, prove, compare and order",
      body: "A chain of agents does the buying. A person holds the key to every payment.",
    },
    {
      kicker: "01  Instruct",
      headline: "Tell it what you need.",
      data: `${d.request.items.map((i) => `${i.quantity} ${i.unit}`).join("  ·  ")}  ·  ${usd(d.request.budget)} budget`,
      body: "Describe the purchase. It becomes one structured request, saved before anything runs.",
    },
    {
      kicker: "02  Source",
      headline: "Suppliers, found and quoted.",
      data: `${d.suppliers.length} suppliers  ·  ${d.suppliers.length} quotes  ·  sample dataset`,
      body: "The agent gathers comparable quotes. It never invents one: if a supplier has no quote, there is no row.",
    },
    {
      kicker: "03  Prove",
      headline: "Evidence, or it does not count.",
      data: `${eligible.length} suppliers fully evidenced  ·  ${review.length} with gaps`,
      body: "Missing evidence is shown as unknown, never as verified. A supplier with gaps is held for review, not recommended.",
    },
    {
      kicker: "04  Compare",
      headline: "Cheapest is not the only test.",
      data: `${totals}  ·  saves ${usd(d.savings)} (estimated)`,
      body: "A deterministic filter decides who is eligible before anything is ranked. Savings are estimates against a stated baseline, never claimed as realised.",
    },
    {
      kicker: "05  Order",
      headline: "Every total, recalculated.",
      data: `${d.order.subtotal.replace(/0{4}$/, "")} + ${d.order.delivery.replace(/0{4}$/, "")} = ${d.order.total.replace(/0{4}$/, "")} ${d.request.currency}`,
      body: "Totals come from unit prices on the server, never from a form or a model. The order is stamped with a fingerprint of everything payable.",
    },
    {
      kicker: "06  Authorise",
      headline: "Responsibility, not unlimited authority.",
      data: `session ${usd(d.session.budget)}  ·  per payment ${usd(d.session.perTransaction)}  ·  ${d.session.minutes} min`,
      body: "Nothing moves until a person turns the key. The agent cannot raise its limits, change the payee or edit an approved order.",
    },
    {
      kicker: "07  Pay",
      headline: "Confirmed by the network, not by the agent.",
      data: `${rec.name}  ·  paid inside the approved session`,
      body: "Payments run through Kite Passport. That integration is in progress, so every figure on this page comes from a fictional sample scenario.",
    },
  ];
}

/** The live ledger in the corner: each line becomes known at a chapter. */
export interface LedgerLine { label: string; value: string; from: number }

export function buildLedger(d: LandingData): LedgerLine[] {
  const eligible = d.suppliers.filter((s) => s.verdict === "eligible").length;
  return [
    { label: "request", value: d.request.number, from: 1 },
    { label: "quotes", value: String(d.suppliers.length), from: 2 },
    { label: "eligible", value: `${eligible} of ${d.suppliers.length}`, from: 3 },
    { label: "total", value: `${d.order.total.replace(/0{4}$/, "")} ${d.request.currency}`, from: 4 },
    { label: "order", value: d.order.number, from: 5 },
    { label: "fingerprint", value: `${d.order.fingerprint.slice(0, 10)}…`, from: 5 },
    { label: "approval", value: "human key", from: 6 },
    { label: "status", value: "confirmed by network", from: 7 },
  ];
}
