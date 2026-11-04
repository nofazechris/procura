import { fromUnits, toUnits } from "@procura/shared";

/** "1630.000000" -> "1,630.00". Exact: goes through BigInt, never a float. */
export function amount(value: string | null | undefined, places = 2): string {
  if (value === null || value === undefined || value === "") return "-";
  try {
    const fixed = fromUnits(toUnits(value), 6, places);
    const negative = fixed.startsWith("-");
    const [whole = "0", frac] = (negative ? fixed.slice(1) : fixed).split(".");
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return `${negative ? "-" : ""}${grouped}${frac !== undefined ? "." + frac : ""}`;
  } catch {
    return value;
  }
}

const SYMBOLS: Record<string, string> = { USD: "$", GBP: "£", EUR: "€", NGN: "₦", GHS: "GH₵" };

/** "$1,630.00" for symbol currencies, "1,630.00 USDC.e" for assets. The currency is always visible. */
export function money(value: string | null | undefined, currency: string, places = 2): string {
  const a = amount(value, places);
  if (a === "-") return a;
  const sym = SYMBOLS[currency];
  return sym ? `${sym}${a}` : `${a} ${currency}`;
}

/** Whole-number-friendly form for tiles and tables: "$1,630" when there are no cents. */
export function moneyShort(value: string | null | undefined, currency: string): string {
  const full = amount(value, 2);
  if (full === "-") return full;
  const trimmed = full.endsWith(".00") ? full.slice(0, -3) : full;
  const sym = SYMBOLS[currency];
  return sym ? `${sym}${trimmed}` : `${trimmed} ${currency}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${hh}:${mm}`;
}

export function timeOfDay(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function relativeTime(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d < 30 ? `${d}d ago` : shortDate(iso);
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return ((parts[0]![0] ?? "") + (parts.length > 1 ? parts[parts.length - 1]![0] ?? "" : "")).toUpperCase();
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

export function shortAddress(a: string): string {
  return a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

export function greeting(now = new Date()): string {
  const h = now.getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

/** a - b for decimal strings, exact. */
export function minus(a: string, b: string): string {
  return fromUnits(toUnits(a) - toUnits(b), 6, 6);
}
