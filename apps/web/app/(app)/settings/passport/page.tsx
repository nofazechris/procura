"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import { useToast } from "@/components/overlays";
import { SettingsTabs } from "@/components/settings-tabs";
import { Async, EmptyState, PageHead, Pill } from "@/components/ui";
import { useApp } from "@/lib/app-context";
import type { PassportDTO, PassportSessionDTO } from "@/lib/dto";
import { errorDetails, errorMessage, usePassport, usePolicy, useRefreshSession, useRegisterAgent, useRequestSession } from "@/lib/queries";

const trimAmount = (a: string) => {
  const [i, f = ""] = a.split(".");
  const frac = f.replace(/0+$/, "");
  return frac ? `${i}.${frac}` : i!;
};
const usd = (a: string) => `$${trimAmount(a)}`;
const fmt = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

const STATUS: Record<PassportSessionDTO["status"], { tone: "ok" | "warn" | "mute" | "info"; label: string }> = {
  requested: { tone: "info", label: "Requested" },
  awaiting_user_approval: { tone: "warn", label: "Waiting for your passkey" },
  active: { tone: "ok", label: "Active" },
  exhausted: { tone: "mute", label: "Used up" },
  expired: { tone: "mute", label: "Expired" },
  revoked: { tone: "mute", label: "Declined" },
  failed: { tone: "mute", label: "Failed" },
};

const DURATIONS = [{ m: 15, l: "15 minutes" }, { m: 60, l: "1 hour" }, { m: 240, l: "4 hours" }, { m: 1440, l: "24 hours" }];

function Status({ p }: { p: PassportDTO }) {
  const live = p.live;
  if (p.liveError) return <div className="callout err" role="alert"><Icon name="alert" /><div>{p.liveError.message}</div></div>;
  if (!live) return null;
  const prod = live.backendEnv === "prod";
  return (
    <div className="card" style={{ padding: 20, display: "grid", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className="k-ic" style={{ width: 38, height: 38 }}><Icon name="shield" /></span>
          <div><b>Passport account</b><div className="mut3" style={{ fontSize: 12 }}>{live.ownerHint ?? "Not signed in"}</div></div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Pill tone={live.loggedIn ? "ok" : "warn"}>{live.loggedIn ? "Signed in" : "Not signed in"}</Pill>
          <Pill tone={prod ? "warn" : "info"}>{prod ? "Production: real funds" : (live.backendEnv ?? "Unknown network")}</Pill>
        </div>
      </div>
      <div style={{ display: "grid", gap: 6, fontSize: 13 }}>
        <div><span className="mut3">Wallet balance: </span><b>{live.wallet.usdcTotal ? `${trimAmount(live.wallet.usdcTotal)} USDC` : "unknown"}</b></div>
        {live.wallet.address ? <div style={{ overflowWrap: "anywhere" }}><span className="mut3">Wallet address: </span>{live.wallet.address}</div> : null}
        <div><span className="mut3">Account allowance: </span>{live.allowance === "none" ? "none set" : live.allowance === "active" ? "set" : "unknown"}</div>
      </div>
      {Number(live.wallet.usdcTotal ?? "0") === 0 ? (
        <div className="callout info"><Icon name="alert" /><div>This Passport wallet holds no funds, so no payment can happen yet even after you approve a session. Approving only sets the limit.</div></div>
      ) : null}
    </div>
  );
}

function SessionRow({ s }: { s: PassportSessionDTO }) {
  const refresh = useRefreshSession();
  const { show } = useToast();
  const st = STATUS[s.status];
  return (
    <div className="card" style={{ padding: 16, display: "grid", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <b style={{ fontSize: 14 }}>{s.taskSummary}</b>
        <Pill tone={st.tone}>{st.label}</Pill>
      </div>
      <div className="mut" style={{ fontSize: 13 }}>
        Up to <b>{usd(s.maxPerTx)}</b> per payment, <b>{usd(s.maxTotal)}</b> in total · requested {fmt(s.createdAt)}{s.expiresAt ? ` · valid until ${fmt(s.expiresAt)}` : ""}
      </div>
      {s.status === "awaiting_user_approval" ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {s.approvalUrl ? <a className="btn btn-pri btn-sm" href={s.approvalUrl} target="_blank" rel="noopener noreferrer"><Icon name="key" /> Approve with your passkey</a> : null}
          <button className="btn btn-sec btn-sm" disabled={refresh.isPending}
            onClick={() => refresh.mutate(s.id, { onSuccess: (r) => show(r.status === "awaiting_user_approval" ? "Still waiting for your approval" : `Session ${STATUS[r.status].label.toLowerCase()}`), onError: (e) => show(errorMessage(e)) })}>
            {refresh.isPending ? "Checking…" : "I approved it, check now"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function RequestForm() {
  const policy = usePolicy();
  const request = useRequestSession();
  const { show } = useToast();
  const [summary, setSummary] = useState("");
  const [perTx, setPerTx] = useState("");
  const [total, setTotal] = useState("");
  const [ttl, setTtl] = useState(60);
  const rejections = (errorDetails(request.error) as { rejections?: { code: string; message: string }[] } | undefined)?.rejections;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    request.mutate({ taskSummary: summary.trim(), maxPerTx: perTx.trim(), maxTotal: total.trim(), ttlMinutes: ttl }, {
      onSuccess: () => { show("Approval request created. Approve it with your passkey."); setSummary(""); setPerTx(""); setTotal(""); },
    });
  };

  return (
    <form className="card" style={{ padding: 20, display: "grid", gap: 14 }} onSubmit={submit} noValidate>
      <div>
        <h3 style={{ fontSize: 15 }}>Request a spending session</h3>
        <p className="mut" style={{ fontSize: 13, marginTop: 4 }}>
          Set the limits the agent must stay inside. Passport enforces them, and nothing can be spent until you approve with your passkey.
          {policy.data ? <> Your policy allows up to <b>{usd(policy.data.maxTransactionAmount)}</b> per payment.</> : null}
        </p>
      </div>
      <div className="fld"><label>What may the agent do?</label>
        <input className="input" value={summary} maxLength={300} placeholder="Check sellers and buy what I asked for" onChange={(e) => setSummary(e.target.value)} /></div>
      <div className="grid-2">
        <div className="fld"><label>Most per payment (USD)</label><input className="input num" inputMode="decimal" value={perTx} placeholder="1" onChange={(e) => setPerTx(e.target.value)} /></div>
        <div className="fld"><label>Most in total (USD)</label><input className="input num" inputMode="decimal" value={total} placeholder="5" onChange={(e) => setTotal(e.target.value)} /></div>
      </div>
      <div className="fld"><label>Lasts</label>
        <select className="input" value={ttl} onChange={(e) => setTtl(Number(e.target.value))}>{DURATIONS.map((d) => <option key={d.m} value={d.m}>{d.l}</option>)}</select></div>
      {request.isError ? (
        <div className="callout err" role="alert"><Icon name="alert" />
          <div>{errorMessage(request.error)}{rejections?.length ? <ul style={{ paddingLeft: 18, marginTop: 6 }}>{rejections.map((r) => <li key={r.code}>{r.message}</li>)}</ul> : null}</div>
        </div>
      ) : null}
      <button className="btn btn-pri" type="submit" disabled={request.isPending}><Icon name="key" /> {request.isPending ? "Asking Passport…" : "Request approval"}</button>
    </form>
  );
}

export default function PassportPage() {
  const { mode } = useApp();
  const passport = usePassport(true);
  const register = useRegisterAgent();
  const { show } = useToast();

  return (
    <>
      <PageHead title="Kite Passport" sub="Your agent's verifiable identity and the spending limits you control. Passport enforces them; a person approves with a passkey." />
      <SettingsTabs />
      {mode === "demo" ? <div className="callout info"><Icon name="alert" /><div>Kite Passport is not available in the demo.</div></div> : (
        <Async query={passport}>
          {(p) => (
            <div style={{ display: "grid", gap: 16 }}>
              {!p.enabled ? (
                <div className="callout warn">
                  <Icon name="lock" />
                  <div>
                    Kite Passport is not switched on for this account. It has one login per server, so it is enabled for a single account.
                    {p.canManage && p.businessId ? <> To enable it for this one, set <code style={{ overflowWrap: "anywhere" }}>PASSPORT_BUSINESS_ID={p.businessId}</code> in the server environment, along with <code>PASSPORT_HOME</code> and <code>KPASS_BIN</code>, then restart.</> : null}
                  </div>
                </div>
              ) : (
                <>
                  <div className="callout info"><Icon name="shield" /><div>Requesting a session creates an approval request only. It spends nothing, and Procura cannot approve it for you: that is your passkey on Kite Passport.</div></div>
                  <Status p={p} />

                  <div className="card" style={{ padding: 20, display: "grid", gap: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span className="k-ic" style={{ width: 38, height: 38 }}><Icon name="key" /></span>
                        <div><b>Agent identity</b><div className="mut3" style={{ fontSize: 12 }}>Registered under your Passport account, so its activity is attributable.</div></div>
                      </div>
                      {p.agent ? <Pill tone="ok">Registered</Pill> : <Pill tone="warn">Not registered</Pill>}
                    </div>
                    {p.agent ? (
                      <div style={{ fontSize: 13, display: "grid", gap: 4 }}>
                        <div><span className="mut3">Type: </span>{p.agent.type}</div>
                        <div style={{ overflowWrap: "anywhere" }}><span className="mut3">Agent id: </span>{p.agent.id}</div>
                      </div>
                    ) : p.canManage ? (
                      <button className="btn btn-pri btn-sm" style={{ justifySelf: "start" }} disabled={register.isPending}
                        onClick={() => register.mutate(undefined, { onSuccess: () => show("Agent registered"), onError: (e) => show(errorMessage(e)) })}>
                        {register.isPending ? "Registering…" : "Register Procura's agent"}
                      </button>
                    ) : null}
                  </div>

                  {p.agent && p.canManage ? <RequestForm /> : null}
                  {!p.canManage ? <div className="callout"><Icon name="lock" /><div>Only you can request spending sessions.</div></div> : null}

                  <div>
                    <div className="eyebrow" style={{ margin: "4px 0 10px" }}>Sessions</div>
                    {p.sessions.length === 0 ? (
                      <EmptyState icon="key" title="No sessions yet">When you request one, it appears here with its limits and approval status.</EmptyState>
                    ) : <div style={{ display: "grid", gap: 10 }}>{p.sessions.map((s) => <SessionRow key={s.id} s={s} />)}</div>}
                  </div>
                </>
              )}
            </div>
          )}
        </Async>
      )}
    </>
  );
}
