import type { LandingData } from "@/lib/landing/data";
import type { SceneData } from "./rack-scene";

/** The plain, serialisable slice of the sample scenario that the 3D rack draws. Shared by the landing story and the sign-in screens. */
export function sceneDataOf(data: LandingData): SceneData {
  return {
    request: {
      number: data.request.number,
      lines: data.request.items.map((i) => `${i.quantity} ${i.name.toLowerCase()}`),
      budget: `$${Number(data.request.budget).toLocaleString("en-US")}`,
    },
    options: data.options.map((o) => ({
      name: o.name, total: o.total, days: o.days, verdict: o.verdict, kind: o.kind, note: o.note, evidence: o.evidence,
      lines: o.lines.map((l) => ({ label: l.short, quantity: l.quantity, price: l.price, rating: l.rating })),
    })),
    tiles: Object.values(data.seed.listings).flat().map((l) => l.price),
    order: { number: data.order.number, total: data.order.total, fingerprint: data.order.fingerprint },
  };
}
