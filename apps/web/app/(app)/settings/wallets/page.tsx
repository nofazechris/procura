"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { DEFAULT_WALLET_CHAIN_ID, KITE_NETWORKS, type KiteChainId } from "@procura/shared";
import { Icon } from "@/components/icon";
import { useToast } from "@/components/overlays";
import { SettingsTabs } from "@/components/settings-tabs";
import { Async, EmptyState, PageHead, Pill, Skeleton } from "@/components/ui";
import { useApp, useCan } from "@/lib/app-context";
import { errorMessage, useRevokeWallet, useWalletBalance, useWallets } from "@/lib/queries";
import { linkBrowserWallet, WalletError } from "@/lib/wallet-client";
import type { WalletDTO } from "@/lib/dto";

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
/** Show up to 4 decimals of an exact decimal string, without rounding through a float. */
const trimAmount = (a: string) => {
  const [i, f = ""] = a.split(".");
  const frac = f.slice(0, 4).replace(/0+$/, "");
  return frac ? `${i}.${frac}` : i!;
};

function Balances({ wallet }: { wallet: WalletDTO }) {
  const q = useWalletBalance(wallet.id);
  const net = KITE_NETWORKS[wallet.chainId as KiteChainId];
  if (q.isLoading) return <Skeleton h={14} w={160} />;
  if (q.isError || q.data?.status === "unavailable") {
    return <span className="mut3" style={{ fontSize: 12.5 }}>Balance unavailable right now. This is not a zero balance.</span>;
  }
  const b = q.data!;
  const empty = b.native && Number(b.native.amount) === 0;
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", fontVariantNumeric: "tabular-nums" }}>
        {b.native ? <span><b>{trimAmount(b.native.amount)}</b> <span className="mut3">{b.native.symbol}</span></span> : null}
        {b.token ? <span><b>{trimAmount(b.token.amount)}</b> <span className="mut3">{b.token.symbol}</span></span> : null}
      </div>
      {b.tokenNotConfigured ? <span className="mut3" style={{ fontSize: 12 }}>Payment token not configured yet, so only the network token is shown.</span> : null}
      {empty && net?.faucetUrl ? <a href={net.faucetUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12.5 }}>Get free test {net.nativeSymbol} from the faucet</a> : null}
    </div>
  );
}

function WalletCard({ wallet, canManage }: { wallet: WalletDTO; canManage: boolean }) {
  const { show } = useToast();
  const revoke = useRevokeWallet();
  const [confirm, setConfirm] = useState(false);
  const net = KITE_NETWORKS[wallet.chainId as KiteChainId];
  const copy = async () => {
    try { await navigator.clipboard.writeText(wallet.address); show("Address copied"); } catch { show("Could not copy"); }
  };
  return (
    <div className="card" style={{ padding: 20, display: "grid", gap: 14, gridTemplateColumns: "minmax(0, 1fr)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className="k-ic" style={{ width: 38, height: 38 }}><Icon name="wallet" /></span>
          <div>
            <b>{wallet.label || "Linked wallet"}</b>
            <div className="mut3" style={{ fontSize: 12 }}>Linked {fmtDate(wallet.linkedAt)}</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <Pill tone="info">{net?.name ?? `Chain ${wallet.chainId}`}</Pill>
          <Pill tone="ok">Ownership proven</Pill>
        </div>
      </div>
      <button
        className="btn btn-sec btn-sm" onClick={copy} aria-label="Copy wallet address"
        style={{ justifySelf: "start", fontFamily: "var(--mono, ui-monospace, monospace)", fontSize: 12.5, maxWidth: "100%", whiteSpace: "normal", wordBreak: "break-all", textAlign: "left", height: "auto", padding: "8px 12px" }}
      >
        {wallet.address} <Icon name="copy" />
      </button>
      <Balances wallet={wallet} />
      {canManage ? (
        <div style={{ display: "flex", gap: 8 }}>
          {!confirm ? <button className="btn btn-ghost btn-sm" onClick={() => setConfirm(true)}>Disconnect</button> : (
            <>
              <button
                className="btn btn-sec btn-sm" disabled={revoke.isPending}
                onClick={() => revoke.mutate(wallet.id, { onSuccess: () => show("Wallet disconnected"), onError: (e) => show(errorMessage(e)) })}
              >
                {revoke.isPending ? "Disconnecting…" : "Yes, disconnect"}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setConfirm(false)}>Keep</button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

export default function WalletsPage() {
  const { mode } = useApp();
  const canManage = useCan("wallet:manage");
  const wallets = useWallets();
  const qc = useQueryClient();
  const { show } = useToast();
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function connect() {
    setErr(null);
    setBusy(true);
    try {
      await linkBrowserWallet(DEFAULT_WALLET_CHAIN_ID, label.trim() || undefined);
      setLabel("");
      await qc.invalidateQueries();
      show("Wallet linked");
    } catch (e) {
      setErr(e instanceof WalletError ? e.message : errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHead title="Wallets" sub="Link the wallets your business pays from. Linking proves you control an address; Procura never holds your keys or your funds." />
      <SettingsTabs />
      {mode === "demo" ? <div className="callout info"><Icon name="alert" /><div>Wallets are only available for real businesses.</div></div> : (
        <>
          <div className="callout info" style={{ marginBottom: 16 }}>
            <Icon name="shield" />
            <div>
              You sign a message to link a wallet. Signing moves no money and gives Procura no access to your funds.
              Procura does not pay from a linked wallet. Spending goes through a capped Kite Passport session you approve with a passkey. This page only
              links wallets and reads balances, on the {KITE_NETWORKS[DEFAULT_WALLET_CHAIN_ID].name}.
            </div>
          </div>

          {canManage ? (
            <div className="card" style={{ padding: 20, marginBottom: 16, display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap" }}>
              <label style={{ display: "grid", gap: 6, flex: "1 1 220px", fontSize: 12.5, fontWeight: 600 }}>
                <span>Label <span className="mut3" style={{ fontWeight: 400 }}>optional</span></span>
                <input className="input" value={label} maxLength={60} placeholder="Operations wallet" onChange={(e) => setLabel(e.target.value)} />
              </label>
              <button className="btn btn-pri" onClick={connect} disabled={busy}>
                <Icon name="wallet" /> {busy ? "Waiting for your wallet…" : "Connect wallet"}
              </button>
              {err ? <div className="callout err" role="alert" style={{ flexBasis: "100%" }}><Icon name="alert" /><div>{err}</div></div> : null}
            </div>
          ) : (
            <div className="callout" style={{ marginBottom: 16 }}><Icon name="lock" /><div>Only the owner and finance managers can link wallets.</div></div>
          )}

          <Async query={wallets}>
            {(rows) => {
              const active = rows.filter((w) => w.status === "active");
              const past = rows.filter((w) => w.status === "revoked");
              return (
                <>
                  {active.length === 0 ? (
                    <EmptyState icon="wallet" title="No wallet linked yet">Connect a browser wallet such as MetaMask to link it to this business.</EmptyState>
                  ) : <div style={{ display: "grid", gap: 14, gridTemplateColumns: "minmax(0, 1fr)" }}>{active.map((w) => <WalletCard key={w.id} wallet={w} canManage={canManage} />)}</div>}
                  {past.length ? (
                    <details style={{ marginTop: 20 }}>
                      <summary className="mut" style={{ cursor: "pointer", fontSize: 13 }}>Disconnected wallets ({past.length})</summary>
                      <ul className="mut3" style={{ fontSize: 12.5, marginTop: 8, display: "grid", gap: 4, paddingLeft: 18 }}>
                        {past.map((w) => <li key={w.id} style={{ overflowWrap: "anywhere" }}>{w.address} · disconnected {w.revokedAt ? fmtDate(w.revokedAt) : ""}</li>)}
                      </ul>
                    </details>
                  ) : null}
                </>
              );
            }}
          </Async>
        </>
      )}
    </>
  );
}
