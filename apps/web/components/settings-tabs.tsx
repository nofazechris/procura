"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/settings/account", label: "Account" },
  { href: "/settings/agent-permissions", label: "Limits" },
  { href: "/settings/passport", label: "Passport" },
  { href: "/settings/wallets", label: "Wallet" },
  { href: "/settings/integrations", label: "Connections" },
];

export function SettingsTabs() {
  const path = usePathname();
  return (
    <nav className="filters" aria-label="Settings sections">
      {TABS.map((t) => <Link key={t.href} href={t.href} className={`filt ${path === t.href ? "on" : ""}`} style={{ textDecoration: "none" }} aria-current={path === t.href ? "page" : undefined}>{t.label}</Link>)}
    </nav>
  );
}
