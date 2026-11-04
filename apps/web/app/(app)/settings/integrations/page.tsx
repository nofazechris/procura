"use client";

import { Icon, type IconName } from "@/components/icon";
import { SettingsTabs } from "@/components/settings-tabs";
import { PageHead, Pill } from "@/components/ui";
import { useApp } from "@/lib/app-context";

interface Integration { name: string; blurb: string; icon: IconName; live: { tone: "ok" | "mute" | "info"; label: string }; demo: { tone: "ok" | "mute" | "info"; label: string } }

const ITEMS: Integration[] = [
  { name: "Neon Postgres", blurb: "Business data, with tenant isolation enforced in the database.", icon: "plug", live: { tone: "ok", label: "Connected" }, demo: { tone: "mute", label: "Not used in demo" } },
  { name: "Kite Passport", blurb: "Financial authority: passkey-approved spending sessions and payments.", icon: "shield", live: { tone: "mute", label: "Not connected" }, demo: { tone: "info", label: "Simulated" } },
  { name: "SERV Reasoning", blurb: "Plain-language requests, supplier evaluation and recommendations.", icon: "spark", live: { tone: "mute", label: "Not connected" }, demo: { tone: "info", label: "Simulated" } },
  { name: "Supplier data", blurb: "Discovery and verification sources. Today: a fictional demo provider.", icon: "users", live: { tone: "info", label: "Demo provider" }, demo: { tone: "info", label: "Demo provider" } },
  { name: "Email", blurb: "Verification, invitations and approval alerts.", icon: "mail", live: { tone: "mute", label: "Not configured" }, demo: { tone: "mute", label: "Not configured" } },
  { name: "Accounting export", blurb: "Sync purchase records to your ledger.", icon: "doc", live: { tone: "mute", label: "Planned" }, demo: { tone: "mute", label: "Planned" } },
];

export default function IntegrationsPage() {
  const { mode } = useApp();
  return (
    <>
      <PageHead title="Integrations" sub="The services behind autonomous procurement, and what is actually connected." />
      <SettingsTabs />
      <div className="grid-3">
        {ITEMS.map((i) => {
          const s = mode === "demo" ? i.demo : i.live;
          return (
            <div key={i.name} className="card" style={{ padding: 20 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <span className="k-ic" style={{ width: 38, height: 38 }}><Icon name={i.icon} /></span>
                <Pill tone={s.tone}>{s.label}</Pill>
              </div>
              <h3 style={{ fontSize: 14.5 }}>{i.name}</h3>
              <p className="mut" style={{ fontSize: 12.5, marginTop: 4 }}>{i.blurb}</p>
            </div>
          );
        })}
      </div>
    </>
  );
}
