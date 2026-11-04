"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icon";
import { useToast } from "@/components/overlays";
import { PassportCard } from "@/components/passport-card";
import { SettingsTabs } from "@/components/settings-tabs";
import { Async, DemoTag, PageHead, Toggle } from "@/components/ui";
import { useApp, useCan } from "@/lib/app-context";
import { amount } from "@/lib/format";
import { errorMessage, usePolicy, useUpdatePolicy } from "@/lib/queries";
import { compare, decimalString } from "@procura/shared";

const LEVELS = [
  { n: 1, name: "Research", text: "Discover suppliers, compare quotations and prepare recommendations. No payments." },
  { n: 2, name: "Prepare", text: "Prepare purchase orders and payment instructions. No financial execution without authorisation." },
  { n: 3, name: "Approved execution", text: "Execute payments within a user-approved spending session and your configured limits." },
];

export default function AgentPermissionsPage() {
  const { mode } = useApp();
  const policy = usePolicy();
  const update = useUpdatePolicy();
  const can = useCan("policy:manage");
  const { show } = useToast();
  const [level, setLevel] = useState(2);
  const [f, setF] = useState({ total: "", tx: "", above: "", required: true });
  const [err, setErr] = useState<Record<string, string>>({});
  const d = policy.data;

  useEffect(() => { if (d) setF({ total: amount(d.maxTotalSpend, 2).replace(/,/g, ""), tx: amount(d.maxTransactionAmount, 2).replace(/,/g, ""), above: d.approvalRequiredAbove ? amount(d.approvalRequiredAbove, 2).replace(/,/g, "") : "", required: d.approvalRequired }); }, [d]);
  useEffect(() => { setLevel(mode === "demo" ? 3 : 2); }, [mode]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!decimalString.safeParse(f.total).success) next["total"] = "Enter an amount such as 20000.";
    if (!decimalString.safeParse(f.tx).success) next["tx"] = "Enter an amount such as 2500.";
    if (f.above && !decimalString.safeParse(f.above).success) next["above"] = "Enter an amount, or leave empty to require approval for every order.";
    if (!next["total"] && !next["tx"] && d && compare({ amount: f.tx, currency: d.currency }, { amount: f.total, currency: d.currency }) > 0) next["tx"] = "The per-purchase limit cannot exceed the monthly budget.";
    setErr(next);
    if (Object.keys(next).length) return;
    try {
      await update.mutateAsync({ maxTotalSpend: f.total, maxTransactionAmount: f.tx, approvalRequiredAbove: f.above || null, approvalRequired: f.required });
      show("Spending limits saved");
    } catch (e2) { show(errorMessage(e2), "err"); }
  }

  return (
    <>
      <PageHead title="Agent permissions" sub="Define what Procura can do on behalf of your business. Your agent can never increase its own authority." />
      <SettingsTabs />
      <div className="lvl-grid">
        {LEVELS.map((l) => {
          const locked = mode === "live" && l.n === 3;
          return (
            <div key={l.n} className={`lvl ${level === l.n ? "on" : ""}`} role="radio" aria-checked={level === l.n} aria-disabled={locked} tabIndex={0}
              style={locked ? { opacity: 0.7, cursor: "not-allowed" } : mode === "live" ? { cursor: "default" } : undefined}
              onClick={() => { if (mode === "demo") { setLevel(l.n); show("Permission level updated (demo)"); } }}>
              <div className="radio" /><div className="ln">Level {l.n}</div><h3>{l.name}</h3><p>{l.text}</p>
              {locked ? <p style={{ marginTop: 10, fontSize: 12, color: "var(--warn)", fontWeight: 600 }}>Available once Kite Passport is connected</p> : null}
            </div>
          );
        })}
      </div>
      {mode === "live" ? <div className="callout info" style={{ marginBottom: 18 }}><Icon name="alert" /><div>Procura is currently at <b>Level 2, Prepare</b>. It can prepare orders but cannot pay, because Kite Passport is not connected.</div></div> : null}

      <div className="two-col" style={{ alignItems: "start" }}>
        <Async query={policy}>
          {(p) => (
            <form className="card" style={{ padding: 22 }} onSubmit={save} noValidate>
              <h2 style={{ fontSize: 16, marginBottom: 6 }}>Spending configuration {mode === "demo" ? <DemoTag>Demo</DemoTag> : null}</h2>
              <p className="mut" style={{ fontSize: 12.5, marginBottom: 14 }}>Procura enforces these limits itself, and Kite Passport enforces its own session limits separately. All amounts are in {p.currency}.</p>
              <div className="fld"><label htmlFor="pt">Maximum monthly spend</label><input id="pt" className="input num" inputMode="decimal" value={f.total} disabled={!can} onChange={(e) => setF({ ...f, total: e.target.value })} aria-invalid={!!err["total"]} />{err["total"] ? <div className="ferr">{err["total"]}</div> : <div className="hint">Hard ceiling across all agents.</div>}</div>
              <div className="fld"><label htmlFor="px">Maximum single purchase</label><input id="px" className="input num" inputMode="decimal" value={f.tx} disabled={!can} onChange={(e) => setF({ ...f, tx: e.target.value })} aria-invalid={!!err["tx"]} />{err["tx"] ? <div className="ferr">{err["tx"]}</div> : <div className="hint">The most any one payment may be.</div>}</div>
              <div className="fld"><label htmlFor="pa">Require approval above</label><input id="pa" className="input num" inputMode="decimal" value={f.above} disabled={!can} placeholder="Every order" onChange={(e) => setF({ ...f, above: e.target.value })} aria-invalid={!!err["above"]} />{err["above"] ? <div className="ferr">{err["above"]}</div> : <div className="hint">Empty means every order needs approval.</div>}</div>
              <div className="cfg-row"><div><div className="lab">Always require approval</div><div className="sub">Ignore the threshold and ask every time</div></div><Toggle on={f.required} onChange={(v) => can && setF({ ...f, required: v })} label="Always require approval" /></div>
              {can ? <button className="btn btn-pri" type="submit" style={{ marginTop: 14 }} disabled={update.isPending}>{update.isPending ? "Saving…" : "Save limits"}</button>
                : <p className="mut3" style={{ fontSize: 12.5, marginTop: 14 }}>Only owners and finance managers can change spending limits.</p>}
            </form>
          )}
        </Async>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <PassportCard />
          <div className="agent-panel" style={{ padding: 20 }}>
            <h3 style={{ color: "#fff", fontSize: 14, marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}><Icon name="shield" /> Security guarantees</h3>
            {["Your agent cannot increase its own spending permissions.", "Every payment is subject to your approved financial limits.", "Only a person can approve where money is sent.", "Revoke access whenever you need to."].map((t) => (
              <div key={t} style={{ display: "flex", gap: 9, alignItems: "flex-start", marginBottom: 10, fontSize: 13, color: "var(--panel-ink)" }}>
                <span style={{ color: "var(--panel-accent)", flex: "none", marginTop: 1, width: 15, display: "flex" }}><Icon name="check" strokeWidth={3} /></span>{t}
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
