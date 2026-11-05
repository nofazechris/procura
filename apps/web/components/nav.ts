import type { IconName } from "./icon";

export interface NavItem { label: string; href: string; icon: IconName; badge?: "approvals" }
export interface NavGroup { group: string; items: NavItem[] }

/** Persistent left navigation. One person, one buyer: no teams, no company analytics. Kept compact: no nesting. */
export const NAV: NavGroup[] = [
  {
    group: "Main",
    items: [
      { label: "Home", href: "/dashboard", icon: "grid" },
      { label: "Requests", href: "/requests", icon: "pkg" },
      { label: "Orders", href: "/orders", icon: "doc" },
      { label: "Sellers", href: "/sellers", icon: "users" },
      { label: "Spending", href: "/payments", icon: "card" },
      { label: "Activity", href: "/activity", icon: "clock" },
    ],
  },
  {
    group: "Your buyer",
    items: [
      { label: "Ask Procura", href: "/assistant", icon: "agent" },
      { label: "Waiting for you", href: "/approvals", icon: "shield", badge: "approvals" },
    ],
  },
  {
    group: "Settings",
    items: [
      { label: "Limits", href: "/settings/agent-permissions", icon: "sliders" },
      { label: "Kite Passport", href: "/settings/passport", icon: "key" },
      { label: "Wallet", href: "/settings/wallets", icon: "wallet" },
      { label: "Account", href: "/settings/account", icon: "cog" },
      { label: "Connections", href: "/settings/integrations", icon: "plug" },
    ],
  },
];

/** Page title for the breadcrumb, from the current path. */
export function titleFor(pathname: string): string {
  const p = pathname.replace(/\/+$/, "") || "/";
  if (/^\/requests\/new$/.test(p)) return "New request";
  if (/^\/requests\/[^/]+\/compare$/.test(p)) return "Compare options";
  if (/^\/requests\/[^/]+$/.test(p)) return "Request";
  if (/^\/sellers\/[^/]+$/.test(p)) return "Seller";
  if (/^\/orders\/[^/]+$/.test(p)) return "Order";
  if (/^\/payments\/[^/]+$/.test(p)) return "Payment";
  if (p === "/settings/wallets") return "Wallet";
  if (p === "/settings/passport") return "Kite Passport";
  const flat = NAV.flatMap((g) => g.items);
  return flat.find((n) => p === n.href)?.label ?? flat.find((n) => p.startsWith(n.href + "/"))?.label ?? "Home";
}

/** Which nav item is active for a path (detail pages highlight their parent). */
export function activeHref(pathname: string): string {
  const flat = NAV.flatMap((g) => g.items);
  return flat.find((n) => pathname === n.href || pathname.startsWith(n.href + "/"))?.href ?? "";
}
