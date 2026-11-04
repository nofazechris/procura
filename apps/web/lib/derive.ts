import { fromUnits, sum, toUnits } from "@procura/shared";
import type { OrderDTO, RequestDTO } from "./dto";

/** Orders that count as money spent: paid or beyond. Pending and cancelled orders are not spend. */
const SPENT = new Set(["paid", "processing", "fulfilled"]);

export const isSpent = (o: OrderDTO) => SPENT.has(o.status);

export function spentOrders(orders: OrderDTO[], currency: string, sinceMs?: number): OrderDTO[] {
  return orders.filter((o) => isSpent(o) && o.currency === currency && (sinceMs === undefined || new Date(o.createdAt).getTime() >= sinceMs));
}

/** Exact total of a set of orders, as a decimal string. */
export function totalOf(orders: OrderDTO[], currency: string): string {
  return sum(orders.map((o) => ({ amount: o.totalAmount, currency })), currency).amount;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Spend per calendar month for the last `count` months, oldest first. */
export function monthlySpend(orders: OrderDTO[], currency: string, count = 6, now = new Date()): { label: string; value: number }[] {
  const out: { key: string; label: string; units: bigint }[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: MONTHS[d.getMonth()]!, units: 0n });
  }
  for (const o of spentOrders(orders, currency)) {
    const d = new Date(o.createdAt);
    const bucket = out.find((b) => b.key === `${d.getFullYear()}-${d.getMonth()}`);
    if (bucket) bucket.units += toUnits(o.totalAmount);
  }
  // Number() is for plotting only; the exact values stay as BigInt until this point.
  return out.map((b) => ({ label: b.label, value: Number(fromUnits(b.units, 6, 2)) }));
}

export function spendBySupplier(orders: OrderDTO[], currency: string): { name: string; units: bigint }[] {
  const map = new Map<string, bigint>();
  for (const o of spentOrders(orders, currency)) map.set(o.supplierName, (map.get(o.supplierName) ?? 0n) + toUnits(o.totalAmount));
  return [...map.entries()].map(([name, units]) => ({ name, units })).sort((a, b) => (a.units < b.units ? 1 : a.units > b.units ? -1 : 0));
}

const ACTIVE = new Set(["submitted", "analysing", "sourcing", "comparing", "awaiting_approval", "approved", "processing"]);
export const isActiveRequest = (r: RequestDTO) => ACTIVE.has(r.status);

/** Average days from a request being created to its purchase order being approved. */
export function averageCycleDays(requests: RequestDTO[], orders: OrderDTO[]): number | null {
  const byId = new Map(requests.map((r) => [r.id, r]));
  const days: number[] = [];
  for (const o of orders) {
    if (!o.approvedAt) continue;
    const r = byId.get(o.requestId);
    if (!r) continue;
    const d = (new Date(o.approvedAt).getTime() - new Date(r.createdAt).getTime()) / 86_400_000;
    if (d >= 0) days.push(d);
  }
  return days.length ? days.reduce((a, b) => a + b, 0) / days.length : null;
}
