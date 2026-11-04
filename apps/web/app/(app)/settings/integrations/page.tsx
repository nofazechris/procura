"use client";

import { Icon, type IconName } from "@/components/icon";
import { SettingsTabs } from "@/components/settings-tabs";
import { PageHead, Pill } from "@/components/ui";
import { useApp } from "@/lib/app-context";
import { useAgentStatus, usePassport } from "@/lib/queries";

interface Integration { name: string; blurb: string; icon: IconName; live: { tone: "ok" | "mute" | "info"; label: string }; demo: { tone: "ok" | "mute" | "info"; label: string } }

const ITEMS: Integration[] = [
  { name: "Neon Postgres", blurb: "Business data, with tenant isolation enforced in the database.", icon: "plug", live: { tone: "ok", label: "Connected" }, demo: { tone: "mute", label: "Not used in demo" } },
  { name: "Kite Passport", blurb: "Agent identity and passkey-approved spending sessions with limits Passport enforces. Sessions pay for supplier checks. Amazon checkout is not built yet.", icon: "shield", live: { tone: "mute", label: "Not connected" }, demo: { tone: "info", label: "Simulated" } },
  { name: "Wallets", blurb: "Link a wallet by signing a message so balances can be read. Procura never pays from it.", icon: "wallet", live: { tone: "info", label: "Linking only" }, demo: { tone: "mute", label: "Not available" } },
  { name: "SERV Reasoning", blurb: "Reads plain-language requests and explains comparisons. The deterministic engine stays the authority.", icon: "agent", live: { tone: "mute", label: "Not connected" }, demo: { tone: "info", label: "Simulated" } },
  { name: "Supplier data", blurb: "Amazon search through Passport is live and free. Supplier checks (sanctions, registry, email) are paid per use from an approved session.", icon: "users", live: { tone: "info", label: "Demo provider" }, demo: { tone: "info", label: "Demo provider" } },
  { name: "Email", blurb: "Verification, invitations and approval alerts.", icon: "mail", live: { tone: "mute", label: "Not configured" }, demo: { tone: "mute", label: "Not configured" } },
  { name: "Accounting export", blurb: "Sync purchase records to your ledger.", icon: "doc", live: { tone: "mute", label: "Planned" }, demo: { tone: "mute", label: "Planned" } },
];

export default function IntegrationsPage() {
  const { mode } = useApp();
  const agent = useAgentStatus();
  const passport = usePassport();
  return (
    <>
      <PageHead title="Integrations" sub="The services behind your AI buyer, and what is actually connected." />
      <SettingsTabs />
      <div className="grid-3">
        {ITEMS.map((i) => {
          const s = mode === "demo" ? i.demo
            : i.name === "SERV Reasoning" && agent.data?.configured ? { tone: "ok" as const, label: "Connected" }
            : i.name === "Kite Passport" && passport.data?.enabled ? (passport.data.agent ? { tone: "ok" as const, label: "Agent registered" } : { tone: "info" as const, label: "Enabled, no agent yet" })
            : i.live;
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
