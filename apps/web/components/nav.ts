import type { IconName } from "./icon";

export interface NavItem { label: string; href: string; icon: IconName; badge?: "approvals" }
export interface NavGroup { group: string; items: NavItem[] }

/** Persistent left navigation (Design PRD s7). Kept compact: no nesting. */
export const NAV: NavGroup[] = [
  {
    group: "Main",
    items: [
      { label: "Overview", href: "/dashboard", icon: "grid" },
      { label: "Procurement", href: "/procurement", icon: "pkg" },
      { label: "Suppliers", href: "/suppliers", icon: "users" },
      { label: "Purchase Orders", href: "/orders", icon: "doc" },
      { label: "Payments", href: "/payments", icon: "card" },
      { label: "Intelligence", href: "/intelligence", icon: "trend" },
      { label: "Activity", href: "/activity", icon: "clock" },
    ],
  },
  {
    group: "Workspace",
    items: [
      { label: "AI Assistant", href: "/assistant", icon: "msg" },
      { label: "Approvals", href: "/approvals", icon: "shield", badge: "approvals" },
    ],
  },
  {
    group: "Settings",
    items: [
      { label: "Agent Permissions", href: "/settings/agent-permissions", icon: "sliders" },
      { label: "Business Settings", href: "/settings/business", icon: "cog" },
      { label: "Integrations", href: "/settings/integrations", icon: "plug" },
    ],
  },
];

/** Page title for the breadcrumb, from the current path. */
export function titleFor(pathname: string): string {
  const p = pathname.replace(/\/+$/, "") || "/";
  if (/^\/procurement\/new$/.test(p)) return "New procurement";
  if (/^\/procurement\/[^/]+\/compare$/.test(p)) return "Supplier comparison";
  if (/^\/procurement\/[^/]+$/.test(p)) return "Procurement workspace";
  if (/^\/suppliers\/[^/]+$/.test(p)) return "Supplier profile";
  if (/^\/orders\/[^/]+$/.test(p)) return "Purchase order";
  if (/^\/payments\/[^/]+$/.test(p)) return "Payment";
  if (p === "/settings/team") return "Team";
  const flat = NAV.flatMap((g) => g.items);
  return flat.find((n) => p === n.href)?.label ?? flat.find((n) => p.startsWith(n.href + "/"))?.label ?? "Overview";
}

/** Which nav item is active for a path (detail pages highlight their parent). */
export function activeHref(pathname: string): string {
  const flat = NAV.flatMap((g) => g.items);
  if (pathname.startsWith("/settings/team")) return "/settings/business";
  return flat.find((n) => pathname === n.href || pathname.startsWith(n.href + "/"))?.href ?? "";
}
