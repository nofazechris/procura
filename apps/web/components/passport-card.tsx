"use client";

import Link from "next/link";
import { Icon } from "./icon";
import { Pill } from "./ui";
import { useApp } from "@/lib/app-context";

/**
 * Kite Passport status. Live mode is honest: it is not connected yet, so every control that
 * would need it is disabled and says why. Demo mode shows a plausible connected state.
 */
export function PassportCard() {
  const { mode } = useApp();
  const demo = mode === "demo";
  const rows: [string, string][] = demo
    ? [["Agent identity", "procura-agent-01"], ["Wallet", "0x4C8e…B217"], ["Network", "Kite testnet"], ["Available balance", "6,810.00 USDC.e"]]
    : [["Agent identity", "Not configured"], ["Wallet", "Not connected"], ["Network", "Kite"], ["Available balance", "-"]];
  return (
    <div className="card passport-card" data-tour="passport-card">
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <span className="k-ic" style={{ background: "var(--forest)", color: "var(--green)" }}><Icon name="shield" /></span>
        <div><h3 style={{ fontSize: 14 }}>Kite Passport</h3><div style={{ marginTop: 3 }}>{demo ? <Pill tone="ok">Connected (demo)</Pill> : <Pill tone="mute">Not connected</Pill>}</div></div>
      </div>
      {rows.map(([l, v]) => <div key={l} className="pp-stat"><span className="mut">{l}</span><span className="v">{v}</span></div>)}
      {demo ? (
        <div className="session-meter">
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12.5 }}><span className="mut">Session budget</span><span className="num" style={{ fontWeight: 700 }}>2,000 / 2,000</span></div>
          <div className="bar"><i style={{ width: "100%" }} /></div>
          <div className="mut3" style={{ fontSize: 11.5, marginTop: 6 }}>A session is requested when you approve a payment. Per-transaction limit 2,500.</div>
        </div>
      ) : (
        <p className="mut" style={{ fontSize: 12.5, margin: "14px 0" }}>Payments need an approved Passport spending session. Connect Kite Passport to let Procura pay inside limits you set. Nothing can be paid until then.</p>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6 }}>
        <Link href="/settings/agent-permissions" className="btn btn-forest btn-sm">Spending limits</Link>
        <button className="btn btn-ghost btn-sm" disabled style={{ color: "var(--ink-3)" }} title={demo ? "Demo only" : "Nothing to revoke until Passport is connected"}>Revoke agent permissions</button>
      </div>
    </div>
  );
}
