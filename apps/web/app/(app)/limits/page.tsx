"use client";

import { useEffect, useState } from "react";
import { compare, decimalString } from "@procura/shared";
import { Icon } from "@/components/icon";
import { useToast } from "@/components/overlays";
import { Async, DemoTag, PageHead, Toggle } from "@/components/ui";
import { useApp, useCan } from "@/lib/app-context";
import { openBuyerPanel } from "@/lib/buyer-panels";
import { amount } from "@/lib/format";
import { errorMessage, useBusinessDetail, usePolicy, useUpdateBusiness, useUpdatePolicy } from "@/lib/queries";

type Choice = "Budget" | "Balanced" | "Premium";
const CHOICES: { v: Choice; title: string; sub: string }[] = [
  { v: "Budget", title: "Lowest price", sub: "Take the cheapest option that meets what you asked for." },
  { v: "Balanced", title: "Balanced", sub: "Prefer well-reviewed options that cost little more than the cheapest." },
  { v: "Premium", title: "Best reviewed", sub: "Prefer the highest-rated options, even if they cost more." },
];

/** What your buyer may spend and how it decides. Everything here is enforced by Procura, and Kite Passport enforces its own session limits on top. */
export default function LimitsPage() {
  const { mode } = useApp();
  const policy = usePolicy();
  const update = useUpdatePolicy();
  const business = useBusinessDetail();
  const updateBusiness = useUpdateBusiness();
  const can = useCan("policy:manage");
  const { show } = useToast();
  const [f, setF] = useState({ total: "", tx: "", above: "", required: true });
  const [err, setErr] = useState<Record<string, string>>({});
  const [choice, setChoice] = useState<Choice>("Balanced");
  const d = policy.data;

  useEffect(() => {
    if (d) setF({ total: amount(d.maxTotalSpend, 2).replace(/,/g, ""), tx: amount(d.maxTransactionAmount, 2).replace(/,/g, ""), above: d.approvalRequiredAbove ? amount(d.approvalRequiredAbove, 2).replace(/,/g, "") : "", required: d.approvalRequired });
  }, [d]);
  useEffect(() => {
    const q = (business.data?.preferences as { quality?: string } | undefined)?.quality;
    setChoice(q === "Budget" || q === "Premium" ? q : "Balanced");
  }, [business.data]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!decimalString.safeParse(f.total).success) next["total"] = "Enter an amount such as 500.";
    if (!decimalString.safeParse(f.tx).success) next["tx"] = "Enter an amount such as 150.";
    if (f.above && !decimalString.safeParse(f.above).success) next["above"] = "Enter an amount, or leave empty to be asked every time.";
    if (!next["total"] && !next["tx"] && d && compare({ amount: f.tx, currency: d.currency }, { amount: f.total, currency: d.currency }) > 0) next["tx"] = "The largest purchase cannot exceed the monthly limit.";
    setErr(next);
    if (Object.keys(next).length) return;
    try {
      await update.mutateAsync({ maxTotalSpend: f.total, maxTransactionAmount: f.tx, approvalRequiredAbove: f.above || null, approvalRequired: f.required });
      show("Limits saved");
    } catch (e2) { show(errorMessage(e2), "err"); }
  }

  async function saveChoice(v: Choice) {
    setChoice(v);
    try { await updateBusiness.mutateAsync({ preferences: { quality: v } }); show("Saved"); } catch (e2) { show(errorMessage(e2), "err"); }
  }

  return (
    <>
      <PageHead title="Limits" sub="How much your buyer may spend, when it must ask you, and how it chooses. It can never raise these itself." />

      <div className="two-col" style={{ alignItems: "start" }}>
        <Async query={policy}>
          {(p) => (
            <form className="card" style={{ padding: 22 }} onSubmit={save} noValidate>
              <h2 style={{ fontSize: 16, marginBottom: 6 }}>What it may spend {mode === "demo" ? <DemoTag>Demo</DemoTag> : null}</h2>
              <p className="mut" style={{ fontSize: 12.5, marginBottom: 14 }}>All amounts are in {p.currency}. Procura checks every order against these. Kite Passport then enforces the limits of the session you approve, separately.</p>
              <div className="fld"><label htmlFor="pt">Monthly limit</label><input id="pt" className="input num" inputMode="decimal" value={f.total} disabled={!can} onChange={(e) => setF({ ...f, total: e.target.value })} aria-invalid={!!err["total"]} />{err["total"] ? <div className="ferr">{err["total"]}</div> : <div className="hint">The most your buyer can spend in a month.</div>}</div>
              <div className="fld"><label htmlFor="px">Largest purchase</label><input id="px" className="input num" inputMode="decimal" value={f.tx} disabled={!can} onChange={(e) => setF({ ...f, tx: e.target.value })} aria-invalid={!!err["tx"]} />{err["tx"] ? <div className="ferr">{err["tx"]}</div> : <div className="hint">The most any single order may be.</div>}</div>
              <div className="fld"><label htmlFor="pa">Ask me for anything above</label><input id="pa" className="input num" inputMode="decimal" value={f.above} disabled={!can} placeholder="Every order" onChange={(e) => setF({ ...f, above: e.target.value })} aria-invalid={!!err["above"]} />{err["above"] ? <div className="ferr">{err["above"]}</div> : <div className="hint">Empty means you are asked about every order.</div>}</div>
              <div className="cfg-row"><div><div className="lab">Always ask me</div><div className="sub">Ignore the amount above and ask about every order</div></div><Toggle on={f.required} onChange={(v) => can && setF({ ...f, required: v })} label="Always ask me" /></div>
              {can ? <button className="btn btn-pri" type="submit" style={{ marginTop: 14 }} disabled={update.isPending}>{update.isPending ? "Saving…" : "Save limits"}</button>
                : <p className="mut3" style={{ fontSize: 12.5, marginTop: 14 }}>Only you can change your limits.</p>}
            </form>
          )}
        </Async>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="card" style={{ padding: 22 }}>
            <h2 style={{ fontSize: 16, marginBottom: 6 }}>How it chooses</h2>
            <p className="mut" style={{ fontSize: 12.5, marginBottom: 12 }}>When several options meet what you asked for, this is what it leans towards. Evidence and your limits always come first.</p>
            <div className="wz-choices" role="radiogroup" aria-label="How your buyer chooses">
              {CHOICES.map((c) => (
                <div key={c.v} role="radio" tabIndex={0} aria-checked={choice === c.v} className={`wz-choice ${choice === c.v ? "on" : ""}`}
                  onClick={() => can && void saveChoice(c.v)} onKeyDown={(e) => { if (can && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); void saveChoice(c.v); } }}>
                  <b>{c.title}</b><span>{c.sub}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="agent-panel" style={{ padding: 20 }}>
            <h3 style={{ color: "#fff", fontSize: 14, marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}><Icon name="shield" /> What stays in your hands</h3>
            {[
              "Your buyer cannot raise its own limits.",
              "It spends only from its own wallet, which you fund.",
              "A payment needs a spending session you approve with your passkey.",
              "Every order is checked against what you approved, down to the cent.",
            ].map((t) => (
              <div key={t} style={{ display: "flex", gap: 9, alignItems: "flex-start", marginBottom: 10, fontSize: 13, color: "var(--panel-ink)" }}>
                <span style={{ color: "var(--panel-accent)", flex: "none", marginTop: 1, width: 15, display: "flex" }}><Icon name="check" strokeWidth={3} /></span>{t}
              </div>
            ))}
            <button className="btn btn-sm" style={{ background: "var(--panel-accent)", color: "var(--panel)", marginTop: 4 }} onClick={() => openBuyerPanel("session")}>Spending session</button>
          </div>
        </div>
      </div>
    </>
  );
}
