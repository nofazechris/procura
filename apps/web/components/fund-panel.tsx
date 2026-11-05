"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BASE_EXPLORER, parseUsdcAmount } from "@procura/shared";
import { Icon } from "@/components/icon";
import { useToast } from "@/components/overlays";
import { useApp } from "@/lib/app-context";
import { usePassport, useWallets } from "@/lib/queries";
import { sendUsdcOnBase, WalletError } from "@/lib/wallet-client";

const trim = (a: string) => { const [i, f = ""] = a.split("."); const fr = f.slice(0, 4).replace(/0+$/, ""); return fr ? `${i}.${fr}` : i!; };
const CHAIN_NAME: Record<string, string> = { base: "Base", polygon: "Polygon", avalanche: "Avalanche", tempo: "Tempo", arc: "Arc", kite: "Kite", solana: "Solana", robinhood: "Robinhood" };
const PRESETS = ["10", "25", "50"];

/**
 * Funding your buyer. Kite Passport keeps its own wallet, and the agent can only spend what that
 * wallet holds, inside a session you approve with a passkey. Kite cannot pull money out of your
 * wallet, so you send USDC to the Passport address. This shows that address and balance, and can
 * start the transfer from the wallet you linked. You confirm it in your wallet.
 */
export function FundPanel({ plain = false }: { plain?: boolean }) {
  const { mode } = useApp();
  const passport = usePassport(true);
  const wallets = useWallets();
  const qc = useQueryClient();
  const { show } = useToast();
  const [amount, setAmount] = useState("25");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState<{ hash: string; amount: string } | null>(null);
  if (mode === "demo") return null;

  const card = (body: React.ReactNode) => (
    <div className={plain ? undefined : "card"} style={plain ? undefined : { padding: 20, marginBottom: 16 }}>
      <div className="sec-head">{plain ? <h3 style={{ margin: 0 }}>Fund your buyer</h3> : <h2>Fund your buyer</h2>}</div>
      {body}
    </div>
  );

  if (passport.isLoading) return card(<p className="mut3" style={{ fontSize: 13 }}>Reading your buyer&apos;s wallet…</p>);
  const p = passport.data;
  if (!p?.enabled) {
    return card(<div className="callout"><Icon name="shield" /><div>Funding opens once Kite Passport is switched on for this account. Until then your buyer can search and compare, but it cannot pay.</div></div>);
  }
  if (p.liveError || !p.live) {
    return card(
      <>
        <div className="callout err"><Icon name="alert" /><div>{p.liveError?.message ?? "Could not read your buyer's wallet right now."} This is not a zero balance.</div></div>
        <button className="btn btn-sec btn-sm" style={{ marginTop: 12 }} onClick={() => void passport.refetch()} disabled={passport.isFetching}>{passport.isFetching ? "Trying…" : "Try again"}</button>
      </>,
    );
  }
  const live = p.live;
  const address = live?.wallet.address ?? null;
  const total = live?.wallet.usdcTotal ?? null;
  const linked = (wallets.data ?? []).filter((w) => w.status === "active").map((w) => w.address);
  const units = parseUsdcAmount(amount);
  const prod = live?.backendEnv === "prod";

  async function copy() {
    if (!address) return;
    try { await navigator.clipboard.writeText(address); show("Address copied"); } catch { show("Could not copy"); }
  }
  async function send() {
    if (!address || !units) return;
    setErr(null); setBusy(true);
    try {
      const r = await sendUsdcOnBase(address, units, linked);
      setSent({ hash: r.hash, amount });
      show("Transfer sent. Your balance updates once it confirms.");
      window.setTimeout(() => void qc.invalidateQueries({ queryKey: [mode] }), 20_000);
    } catch (e) {
      setErr(e instanceof WalletError ? e.message : "The transfer could not be sent.");
    } finally { setBusy(false); }
  }

  return card(
    <>
      <p className="mut" style={{ fontSize: 12.5, marginBottom: 14 }}>
        Your buyer pays from its own Kite Passport wallet. Kite cannot take money from your wallet, so you send USDC to this address. Sending funds
        does not let the agent spend: it can only spend inside a session you approve with your passkey, within your limits.
      </p>

      <div style={{ display: "grid", gap: 4, marginBottom: 14 }}>
        <span className="mut3" style={{ fontSize: 12 }}>Passport wallet balance</span>
        <b className="num" style={{ fontSize: 26 }}>{total ? trim(total) : "-"} <span className="mut3" style={{ fontSize: 14, fontWeight: 500 }}>USDC</span></b>
        {live?.wallet.chains.some((c) => Number(c.amount) > 0)
          ? <span className="mut3" style={{ fontSize: 12 }}>{live.wallet.chains.filter((c) => Number(c.amount) > 0).map((c) => `${trim(c.amount)} on ${CHAIN_NAME[c.chain] ?? c.chain}`).join(" · ")}</span>
          : <span className="mut3" style={{ fontSize: 12 }}>Nothing yet, so no payment can happen.</span>}
      </div>

      {address ? (
        <div className="recipient-box" style={{ margin: "0 0 14px" }}>
          <span className="k-ic" style={{ background: "var(--surface)", color: "var(--forest-2)" }}><Icon name="wallet" /></span>
          <div style={{ flex: 1, minWidth: 140 }}>
            <div style={{ fontSize: 12, fontWeight: 600 }}>Send USDC on Base to</div>
            <div className="addr" style={{ overflowWrap: "anywhere" }}>{address}</div>
          </div>
          <button className="btn btn-sec btn-sm" onClick={() => void copy()}>Copy</button>
        </div>
      ) : <div className="callout err" style={{ marginBottom: 14 }}><Icon name="alert" /><div>Could not read the Passport wallet address right now. Try again in a moment.</div></div>}

      {prod ? <div className="callout warn" style={{ marginBottom: 14 }}><Icon name="alert" /><div><b>This is real money.</b> Send only USDC, on Base. Other tokens or networks sent to this address may be lost. Start with a small amount.</div></div> : null}

      <div className="fld"><label htmlFor="fund-amt">Amount to send (USDC)</label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input id="fund-amt" className="input num" style={{ maxWidth: 140 }} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={!units} />
          {PRESETS.map((v) => <button key={v} type="button" className="btn btn-ghost btn-sm" onClick={() => setAmount(v)}>{v}</button>)}
        </div>
        {!units ? <div className="ferr">Enter an amount such as 25 or 12.50.</div> : null}
      </div>
      {linked.length === 0 ? (
        <div className="callout err"><Icon name="alert" /><div>Connect your wallet first. Funding comes from the wallet you linked, so every purchase traces back to you.</div></div>
      ) : (
        <button className="btn btn-pri" disabled={busy || !address || !units} onClick={() => void send()}>
          <Icon name="wallet" /> {busy ? "Confirm in your wallet…" : `Send ${units ? amount.trim() : ""} USDC from my wallet`}
        </button>
      )}
      {err ? <div role="alert" style={{ color: "var(--err)", fontSize: 12.5, marginTop: 10 }}>{err}</div> : null}
      {sent ? (
        <div className="callout ok" style={{ marginTop: 12 }}><Icon name="check" /><div>
          Sent {sent.amount} USDC. It can take a minute to arrive.{" "}
          <a href={`${BASE_EXPLORER}/tx/${sent.hash}`} target="_blank" rel="noreferrer" style={{ textDecoration: "underline" }}>View the transaction</a>.{" "}
          <button className="linkbtn" onClick={() => void qc.invalidateQueries({ queryKey: [mode] })}>Check balance</button>
        </div></div>
      ) : null}
      <p className="mut3" style={{ fontSize: 12, marginTop: 12 }}>Or send USDC on Base to the address above from any wallet or exchange.</p>
    </>,
  );
}
