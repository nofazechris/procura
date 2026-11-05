"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { DEFAULT_WALLET_CHAIN_ID, shortAddress } from "@procura/shared";
import { FundPanel } from "@/components/fund-panel";
import { Icon } from "@/components/icon";
import { Modal, useToast } from "@/components/overlays";
import { Pill } from "@/components/ui";
import { useApp } from "@/lib/app-context";
import { onBuyerPanel, openBuyerPanel, type BuyerPanel } from "@/lib/buyer-panels";
import type { PassportSessionDTO } from "@/lib/dto";
import { errorDetails, errorMessage, usePassport, usePolicy, useRefreshSession, useRegisterAgent, useRequestSession, useRevokeWallet, useWallets } from "@/lib/queries";
import { linkBrowserWallet, WalletError } from "@/lib/wallet-client";

const trim = (a: string) => { const [i, f = ""] = a.split("."); const fr = f.replace(/0+$/, ""); return fr ? `${i}.${fr}` : i!; };
const usd = (a: string) => `$${trim(a)}`;
const fmt = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Mounted once in the app frame. Anything can open one of the three dialogs with openBuyerPanel(). */
export function BuyerPanels() {
  const { mode } = useApp();
  const [panel, setPanel] = useState<BuyerPanel | null>(null);
  useEffect(() => onBuyerPanel((p) => { if (mode === "live") setPanel(p); }), [mode]);
  // A link such as /dashboard?buyer=fund opens the dialog straight away.
  useEffect(() => {
    const want = new URLSearchParams(window.location.search).get("buyer");
    if (mode === "live" && (want === "wallet" || want === "fund" || want === "session")) {
      setPanel(want);
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, [mode]);
  const close = () => setPanel(null);
  return (
    <>
      <Modal open={panel === "wallet"} onClose={close} label="Your wallet" wide><div style={{ padding: 22 }}><WalletPanel /></div></Modal>
      <Modal open={panel === "fund"} onClose={close} label="Fund your buyer" wide><div style={{ padding: 22 }}><FundPanel plain /></div></Modal>
      <Modal open={panel === "session"} onClose={close} label="Spending session" wide><div style={{ padding: 22 }}><SessionPanel /></div></Modal>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Wallet                                                              */
/* ------------------------------------------------------------------ */

function WalletPanel() {
  const wallets = useWallets();
  const revoke = useRevokeWallet();
  const qc = useQueryClient();
  const { show } = useToast();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const linked = (wallets.data ?? []).find((w) => w.status === "active") ?? null;

  async function connect() {
    setErr(null); setBusy(true);
    try {
      await linkBrowserWallet(DEFAULT_WALLET_CHAIN_ID);
      await qc.invalidateQueries();
      show("Wallet connected");
    } catch (e) {
      setErr(e instanceof WalletError ? e.message : errorMessage(e));
    } finally { setBusy(false); }
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div>
        <h3 style={{ margin: 0 }}>Your wallet</h3>
        <p className="mut" style={{ fontSize: 13, margin: "6px 0 0" }}>
          You sign one message to prove the wallet is yours. Signing moves no money and gives Procura no access to your funds. It is the wallet you fund your
          buyer from, so every purchase traces back to you.
        </p>
      </div>
      {linked ? (
        <div className="recipient-box" style={{ margin: 0 }}>
          <span className="k-ic" style={{ background: "var(--surface)", color: "var(--forest-2)" }}><Icon name="wallet" /></span>
          <div style={{ flex: 1, minWidth: 140 }}>
            <div style={{ fontSize: 12, fontWeight: 600 }}>Connected <Pill tone="ok">Ownership proven</Pill></div>
            <div className="addr" style={{ overflowWrap: "anywhere" }}>{linked.address}</div>
          </div>
          <button className="btn btn-ghost btn-sm" disabled={revoke.isPending}
            onClick={() => revoke.mutate(linked.id, { onSuccess: () => show("Wallet disconnected"), onError: (e) => show(errorMessage(e), "err") })}>
            {revoke.isPending ? "Disconnecting…" : "Disconnect"}
          </button>
        </div>
      ) : (
        <button className="btn btn-pri" style={{ justifySelf: "start" }} disabled={busy} onClick={() => void connect()}>
          <Icon name="wallet" /> {busy ? "Waiting for your wallet…" : "Connect wallet"}
        </button>
      )}
      {err ? <div role="alert" style={{ color: "var(--err)", fontSize: 12.5 }}>{err}</div> : null}
      {linked ? <div><button className="btn btn-sec" onClick={() => openBuyerPanel("fund")}><Icon name="card" /> Next: fund your buyer</button></div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Spending session                                                    */
/* ------------------------------------------------------------------ */

const STATUS: Record<PassportSessionDTO["status"], { tone: "ok" | "warn" | "mute" | "info"; label: string }> = {
  requested: { tone: "info", label: "Requested" },
  awaiting_user_approval: { tone: "warn", label: "Waiting for your passkey" },
  active: { tone: "ok", label: "Active" },
  exhausted: { tone: "mute", label: "Used up" },
  expired: { tone: "mute", label: "Expired" },
  revoked: { tone: "mute", label: "Declined" },
  failed: { tone: "mute", label: "Failed" },
};
const DURATIONS = [{ m: 60, l: "1 hour" }, { m: 240, l: "4 hours" }, { m: 1440, l: "24 hours" }];

function SessionRow({ s }: { s: PassportSessionDTO }) {
  const refresh = useRefreshSession();
  const { show } = useToast();
  // A session Passport last called active can still have run out of time since.
  const lapsed = s.status === "active" && s.expiresAt !== null && new Date(s.expiresAt).getTime() <= Date.now();
  const st = STATUS[lapsed ? "expired" : s.status];
  return (
    <div className="card" style={{ padding: 14, display: "grid", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <b style={{ fontSize: 13.5 }}>Up to {usd(s.maxTotal)} in total, {usd(s.maxPerTx)} a payment</b>
        <Pill tone={st.tone}>{st.label}</Pill>
      </div>
      <div className="mut3" style={{ fontSize: 12 }}>Requested {fmt(s.createdAt)}{s.expiresAt ? ` · valid until ${fmt(s.expiresAt)}` : ""}</div>
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

function SessionPanel() {
  const passport = usePassport();
  const policy = usePolicy();
  const register = useRegisterAgent();
  const request = useRequestSession();
  const { show } = useToast();
  const [total, setTotal] = useState("100");
  const [perTx, setPerTx] = useState("100");
  const [ttl, setTtl] = useState(60);
  const p = passport.data;
  const rejections = (errorDetails(request.error) as { rejections?: { code: string; message: string }[] } | undefined)?.rejections;

  if (passport.isLoading) return <p className="mut3" style={{ fontSize: 13 }}>Loading…</p>;
  if (!p?.enabled) {
    return (
      <div style={{ display: "grid", gap: 10 }}>
        <h3 style={{ margin: 0 }}>Spending session</h3>
        <div className="callout"><Icon name="lock" /><div>Paying opens once Kite Passport is switched on for this account. Until then your buyer can search and compare, but it cannot pay.</div></div>
      </div>
    );
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    request.mutate({ taskSummary: "Check sellers and buy what I asked for, inside my limits", maxPerTx: perTx.trim(), maxTotal: total.trim(), ttlMinutes: ttl }, {
      onSuccess: () => show("Approval request created. Approve it with your passkey."),
    });
  };

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div>
        <h3 style={{ margin: 0 }}>Spending session</h3>
        <p className="mut" style={{ fontSize: 13, margin: "6px 0 0" }}>
          A session is how you let your buyer pay: a total, a most-per-payment and a time limit. Kite Passport enforces it, and nothing can be spent until you
          approve with your passkey. Procura cannot approve it for you.
          {policy.data ? <> Your own limits allow up to <b>{usd(policy.data.maxTransactionAmount)}</b> a payment.</> : null}
        </p>
      </div>

      {!p.agent ? (
        <div className="callout"><Icon name="key" /><div>
          Your buyer needs an identity first, so everything it does is traceable to you.
          <div style={{ marginTop: 8 }}>
            <button className="btn btn-pri btn-sm" disabled={register.isPending} onClick={() => register.mutate(undefined, { onSuccess: () => show("Identity created"), onError: (e) => show(errorMessage(e)) })}>
              {register.isPending ? "Creating…" : "Create my buyer's identity"}
            </button>
          </div>
        </div></div>
      ) : p.canManage ? (
        <form style={{ display: "grid", gap: 12 }} onSubmit={submit} noValidate>
          <div className="grid-2">
            <div className="fld" style={{ marginBottom: 0 }}><label htmlFor="ss-total">Most in total (USD)</label><input id="ss-total" className="input num" inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} /></div>
            <div className="fld" style={{ marginBottom: 0 }}><label htmlFor="ss-tx">Most per payment (USD)</label><input id="ss-tx" className="input num" inputMode="decimal" value={perTx} onChange={(e) => setPerTx(e.target.value)} /></div>
          </div>
          <div className="fld" style={{ marginBottom: 0 }}><label htmlFor="ss-ttl">Lasts</label>
            <select id="ss-ttl" className="input" value={ttl} onChange={(e) => setTtl(Number(e.target.value))}>{DURATIONS.map((d) => <option key={d.m} value={d.m}>{d.l}</option>)}</select></div>
          <p className="mut3" style={{ fontSize: 12, margin: 0 }}>For an Amazon order, a session must cover the order plus a buffer of the larger of 20% or $5, plus a $1 fee. Unused money is refunded.</p>
          {request.isError ? (
            <div className="callout err" role="alert"><Icon name="alert" />
              <div>{errorMessage(request.error)}{rejections?.length ? <ul style={{ paddingLeft: 18, marginTop: 6 }}>{rejections.map((r) => <li key={r.code}>{r.message}</li>)}</ul> : null}</div>
            </div>
          ) : null}
          <button className="btn btn-pri" type="submit" disabled={request.isPending} style={{ justifySelf: "start" }}><Icon name="key" /> {request.isPending ? "Asking Passport…" : "Request approval"}</button>
        </form>
      ) : <div className="callout"><Icon name="lock" /><div>Only you can request spending sessions.</div></div>}

      {p.sessions.length ? (
        <div>
          <div className="eyebrow" style={{ margin: "4px 0 8px" }}>Your sessions</div>
          <div style={{ display: "grid", gap: 8 }}>{p.sessions.slice(0, 5).map((s) => <SessionRow key={s.id} s={s} />)}</div>
        </div>
      ) : null}
    </div>
  );
}
