"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/settings/business", label: "Business" },
  { href: "/settings/team", label: "Team" },
  { href: "/settings/agent-permissions", label: "Agent permissions" },
  { href: "/settings/integrations", label: "Integrations" },
];

export function SettingsTabs() {
  const path = usePathname();
  return (
    <nav className="filters" aria-label="Settings sections">
      {TABS.map((t) => <Link key={t.href} href={t.href} className={`filt ${path === t.href ? "on" : ""}`} style={{ textDecoration: "none" }} aria-current={path === t.href ? "page" : undefined}>{t.label}</Link>)}
    </nav>
  );
}
