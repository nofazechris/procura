"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { estimateCost } from "@procura/procurement/core";
import { Icon } from "@/components/icon";
import { useToast } from "@/components/overlays";
import { Pill } from "@/components/ui";
import { useApp } from "@/lib/app-context";
import { openBuyerPanel } from "@/lib/buyer-panels";
import type { VerifyRunDTO } from "@/lib/dto";
import { errorMessage, useVerifyPlan, useVerifySupplier } from "@/lib/queries";

const trim = (a: string) => { const [i, f = ""] = a.split("."); const fr = f.replace(/0+$/, ""); return fr ? `${i}.${fr}` : i!; };
const usd = (a: string) => `$${trim(a)}`;
const TONE = { verified: "ok", unverified: "warn", unknown: "mute", failed: "err" } as const;
const WORD = { verified: "Verified", unverified: "Not verified", unknown: "Unknown", failed: "Failed" } as const;

/**
 * Paid checks on a seller, bought through an approved Kite Passport session. Nothing is bought until
 * the person presses the button, and the button says exactly what it will spend.
 */
export function VerifyPanel({ supplierId, canSpend }: { supplierId: string; canSpend: boolean }) {
  const { mode } = useApp();
  const plan = useVerifyPlan(supplierId);
  const run = useVerifySupplier(supplierId);
  const { show } = useToast();
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [sessionId, setSessionId] = useState("");
  const [result, setResult] = useState<VerifyRunDTO | null>(null);

  const d = plan.data;
  useEffect(() => {
    if (!d) return;
    setPicked((p) => (Object.keys(p).length ? p : Object.fromEntries(d.checks.filter((c) => c.ready).map((c) => [c.id, true]))));
    setSessionId((s) => (s && d.sessions.some((x) => x.id === s) ? s : d.sessions[0]?.id ?? ""));
  }, [d]);

  const chosen = useMemo(() => (d?.checks ?? []).filter((c) => c.ready && picked[c.id]), [d, picked]);
  const total = useMemo(() => estimateCost(chosen.map((c) => ({ id: c.id, price: c.price, ready: true, missing: null }))), [chosen]);

  if (mode === "demo") return null;
  const card = (children: React.ReactNode) => <div className="card" style={{ padding: 20 }}><div className="sec-head"><h2>Check this seller</h2></div>{children}</div>;

  if (plan.isLoading) return card(<p className="mut3" style={{ fontSize: 13 }}>Checking what can be verified…</p>);
  if (plan.isError) return card(<p className="mut" style={{ fontSize: 13 }}>{errorMessage(plan.error)}</p>);
  if (!d) return null;
  if (!d.enabled) {
    return card(
      <div className="callout"><Icon name="shield" /><div>
        Verification checks are bought through Kite Passport, which is not set up for this business.{" "}
        <button className="linkbtn" style={{ textDecoration: "underline" }} onClick={() => openBuyerPanel("session")}>Set up spending</button>
      </div></div>,
    );
  }

  const session = d.sessions.find((s) => s.id === sessionId);
  const blocked = !canSpend ? "Only you can spend from a session."
    : !session ? "No approved spending session. Ask for one in Passport settings, approve it with your passkey, then come back."
    : chosen.length === 0 ? "Choose at least one check." : null;

  async function go() {
    if (!session || chosen.length === 0) return;
    try {
      const r = await run.mutateAsync({ checks: chosen.map((c) => c.id), sessionId: session.id, maxCost: total });
      setResult(r);
      const done = r.reports.filter((x) => x.state === "done").length;
      show(done ? `${done} check${done === 1 ? "" : "s"} recorded` : "No check completed", done ? "ok" : "err");
    } catch (e) { show(errorMessage(e), "err"); }
  }

  return card(
    <>
      <p className="mut" style={{ fontSize: 12.5, marginBottom: 12 }}>
        Each check is a small paid lookup. You choose which to run, and the price is shown before anything is spent. A result never
        counts as verified unless the answer clearly says so.
      </p>
      {d.checks.map((c) => (
        <label key={c.id} className="ev-row" style={{ cursor: c.ready ? "pointer" : "default", opacity: c.ready ? 1 : 0.6, alignItems: "flex-start" }}>
          <input type="checkbox" disabled={!c.ready} checked={!!picked[c.id] && c.ready} onChange={(e) => setPicked((p) => ({ ...p, [c.id]: e.target.checked }))} style={{ marginTop: 3 }} />
          <div style={{ flex: 1 }}>
            <div className="et" style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><span>{c.label}</span><span className="num mut3">{usd(c.price)}</span></div>
            <div className="es">{c.ready ? c.proves : `Add ${c.missing} to this seller to run it.`}</div>
            {c.ready ? <div className="es" style={{ opacity: 0.8 }}>{c.limit}</div> : null}
          </div>
        </label>
      ))}

      {d.sessions.length > 1 ? (
        <div className="fld" style={{ marginTop: 14 }}><label htmlFor="vf-session">Pay from</label>
          <select id="vf-session" className="input" value={sessionId} onChange={(e) => setSessionId(e.target.value)}>
            {d.sessions.map((s) => <option key={s.id} value={s.id}>{s.taskSummary.slice(0, 60)} (up to {usd(s.maxTotal)})</option>)}
          </select></div>
      ) : session ? <p className="mut3" style={{ fontSize: 12, marginTop: 12 }}>Pays from: {session.taskSummary.slice(0, 80)}, up to {usd(session.maxTotal)}.</p> : null}

      <button className="btn btn-pri" style={{ marginTop: 14, width: "100%", justifyContent: "center" }} disabled={!!blocked || run.isPending} onClick={() => void go()}>
        {run.isPending ? "Running checks…" : `Pay ${usd(total)} and run ${chosen.length} check${chosen.length === 1 ? "" : "s"}`}
      </button>
      {blocked ? <p className="mut3" style={{ fontSize: 12, marginTop: 8 }}>{blocked}</p> : null}

      {result ? (
        <div style={{ marginTop: 16, display: "grid", gap: 10 }} aria-live="polite">
          {result.reports.map((r) => (
            <div key={r.check} className="insight" style={{ marginBottom: 0 }}>
              <div className="ic" style={{ color: r.state === "done" ? (r.outcome?.status === "verified" ? "var(--ok)" : r.outcome?.status === "failed" ? "var(--err)" : "var(--warn)") : "var(--ink-3)" }}>
                <Icon name={r.state === "done" && r.outcome?.status === "verified" ? "check" : "alert"} />
              </div>
              <div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <b style={{ fontSize: 13 }}>{r.label}</b>
                  {r.state === "done" && r.outcome ? <Pill tone={TONE[r.outcome.status]}>{WORD[r.outcome.status]}</Pill> : <Pill tone="mute">{r.state === "skipped" ? "Not run" : "Not completed"}</Pill>}
                  {r.state === "done" && r.charged ? <span className="num mut3" style={{ fontSize: 12 }}>charged {usd(r.charged)}</span> : null}
                </div>
                <p style={{ margin: "4px 0 0", fontSize: 12.5 }} className="mut">{r.outcome?.summary ?? r.error?.message}</p>
              </div>
            </div>
          ))}
          {result.stopped ? <p className="mut3" style={{ fontSize: 12 }}>The run stopped early. Anything not charged is shown above.</p> : null}
        </div>
      ) : null}
    </>,
  );
}
