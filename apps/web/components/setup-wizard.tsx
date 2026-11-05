"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { DEFAULT_WALLET_CHAIN_ID, decimalString, KITE_NETWORKS, shortAddress } from "@procura/shared";
import { api, ApiClientError } from "@/lib/api-client";
import { linkBrowserWallet, WalletError } from "@/lib/wallet-client";
import type { SceneData } from "./landing/rack-scene";
import { AuthScene } from "./auth-scene";
import { Icon } from "./icon";
import { ToastProvider, useToast } from "./overlays";

const STEPS = ["You", "What you buy", "How it chooses", "Limits", "Fund your agent", "Ready"];
/** Where the 3D rack is for each step: the agent is built up as the questions are answered. */
const RACK_PROGRESS = [0.15, 0.3, 0.45, 0.84, 0.95, 1];
const CAPTIONS = [
  "It starts by knowing who it works for.",
  "Then what you buy, so it knows where to look.",
  "How it should choose when options are close.",
  "The limits it can never go past.",
  "Link the wallet you fund it from.",
  "Ready. It can search now, and it asks before it spends.",
];

const COUNTRIES: [string, string][] = [["NG", "Nigeria"], ["GH", "Ghana"], ["KE", "Kenya"], ["ZA", "South Africa"], ["GB", "United Kingdom"], ["US", "United States"], ["AE", "United Arab Emirates"], ["IN", "India"], ["CA", "Canada"]];
const CURRENCIES = ["USD", "NGN", "GBP", "EUR", "GHS", "KES", "ZAR"];
const CATEGORIES = ["Electronics", "Home & kitchen", "Office & desk", "Tools & hardware", "Groceries & household", "Health & personal care", "Pets", "Gifts", "Books & media", "Sports & outdoors"];

type Choice = "Budget" | "Balanced" | "Premium";
const CHOICES: { value: Choice; title: string; sub: string }[] = [
  { value: "Budget", title: "Lowest price", sub: "Take the cheapest option that meets the requirements." },
  { value: "Balanced", title: "Balanced", sub: "Prefer well-reviewed options that cost little more than the cheapest." },
  { value: "Premium", title: "Best reviewed", sub: "Prefer the highest-rated options, even if they cost more." },
];

interface State {
  name: string; industry: string; countryCode: string; currency: string; size: string; website: string;
  categories: string[]; quality: Choice; monthly: string; single: string; above: string;
}

/**
 * First-run setup, shown as a modal over the dashboard until your buyer exists. It cannot be
 * dismissed: nothing in the product works without your spending limits. A 3D rack
 * beside the form builds up as each step is answered.
 */
export function SetupWizard({ userName, scene }: { userName: string; scene: SceneData }) {
  return <ToastProvider><Wizard userName={userName} scene={scene} /></ToastProvider>;
}

function Wizard({ userName, scene }: { userName: string; scene: SceneData }) {
  const router = useRouter();
  const { show } = useToast();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [custom, setCustom] = useState("");
  // Your account record is created when Limits is done, so a wallet can be linked to it before the wizard ends.
  const [created, setCreated] = useState(false);
  const [wallet, setWallet] = useState<{ address: string } | null>(null);
  const [walletBusy, setWalletBusy] = useState(false);
  const [walletErr, setWalletErr] = useState<string | null>(null);
  const [s, setS] = useState<State>({
    name: userName.trim(), industry: "Personal", countryCode: "NG", currency: "USD", size: "1", website: "",
    categories: [], quality: "Balanced", monthly: "500", single: "150", above: "50",
  });
  const set = (patch: Partial<State>) => setS((cur) => ({ ...cur, ...patch }));

  const clean = (v: string) => v.replace(/,/g, "").trim();

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (step === 1 && s.categories.length === 0) e["categories"] = "Select at least one category.";
    if (step === 3) {
      if (!decimalString.safeParse(clean(s.monthly)).success || Number(clean(s.monthly)) <= 0) e["monthly"] = "Enter a monthly limit such as 500.";
      if (!decimalString.safeParse(clean(s.single)).success || Number(clean(s.single)) <= 0) e["single"] = "Enter a maximum such as 150.";
      if (!e["monthly"] && !e["single"] && Number(clean(s.single)) > Number(clean(s.monthly))) e["single"] = "This cannot exceed the monthly limit.";
      if (s.above.trim() && !decimalString.safeParse(clean(s.above)).success) e["above"] = "Enter an amount, or leave empty to approve every purchase.";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  /** Creates your account record and its spending policy. Runs once; the wizard stays open for the wallet step. */
  async function createBusiness(): Promise<boolean> {
    setBusy(true);
    try {
      await api("/business", {
        method: "POST",
        body: {
          name: s.name.trim().length >= 2 ? s.name.trim() : "My purchases", industry: s.industry, countryCode: s.countryCode, defaultCurrency: s.currency,
          monthlyBudget: clean(s.monthly), maxSinglePurchase: clean(s.single), ...(s.above.trim() ? { approvalRequiredAbove: clean(s.above) } : {}),
          preferences: { size: s.size, categories: s.categories, quality: s.quality },
        },
      });
      setCreated(true);
      return true;
    } catch (err) {
      show(err instanceof ApiClientError ? err.message : "We could not set up your buyer. Please try again.", "err");
      return false;
    } finally {
      setBusy(false);
    }
  }

  /** The layout now finds a business, so the real dashboard replaces this frame. */
  function finish(to?: string) {
    setBusy(true);
    if (to) router.replace(to);
    router.refresh();
  }

  async function connectWallet() {
    setWalletErr(null);
    setWalletBusy(true);
    try {
      const w = await linkBrowserWallet(DEFAULT_WALLET_CHAIN_ID);
      setWallet({ address: w.address });
    } catch (e) {
      setWalletErr(e instanceof WalletError ? e.message : e instanceof ApiClientError ? e.message : "We could not link that wallet. You can try again later in Settings.");
    } finally {
      setWalletBusy(false);
    }
  }

  const next = async () => {
    if (!validate()) return;
    if (step === 3 && !created) { if (!(await createBusiness())) return; }
    if (step < STEPS.length - 1) setStep(step + 1); else finish();
  };
  const toggleCat = (c: string) => set({ categories: s.categories.includes(c) ? s.categories.filter((x) => x !== c) : [...s.categories, c] });
  const addCustom = () => { const c = custom.trim(); if (c && !s.categories.includes(c)) set({ categories: [...s.categories, c] }); setCustom(""); };

  const seg = <T extends string>(options: readonly T[], value: T, onPick: (v: T) => void, label: string) => (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((o) => <div key={o} role="radio" tabIndex={0} aria-checked={value === o} className={`seg-i ${value === o ? "on" : ""}`} onClick={() => onPick(o)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(o); } }}>{o}</div>)}
    </div>
  );
  const err = (k: string) => (errors[k] ? <div role="alert" style={{ color: "var(--err)", fontSize: 12, marginTop: 6 }}>{errors[k]}</div> : null);
  const money = (key: "monthly" | "single" | "above", label: string, ph?: string) => (
    <div className="ob-field"><label htmlFor={key}>{label}</label>
      <div style={{ position: "relative" }}>
        <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--ink-3)", fontWeight: 600, fontSize: 12, pointerEvents: "none" }}>{s.currency}</span>
        <input id={key} className="ob-input num" style={{ paddingLeft: 50 }} inputMode="decimal" value={s[key]} placeholder={ph} onChange={(e) => set({ [key]: e.target.value } as Partial<State>)} aria-invalid={!!errors[key]} />
      </div>{err(key)}</div>
  );
  const single = clean(s.single), above = clean(s.above);

  return (
    <div className="overlay on" style={{ zIndex: 150 }}>
      <div className="modal setup-modal wz" role="dialog" aria-modal="true" aria-label="Set up your buyer">
        <aside className="wz-visual" aria-hidden="true">
          <AuthScene scene={scene} progress={RACK_PROGRESS[step]!} caption="" />
          <div className="wz-cap">
            <div className="wz-step">{String(step + 1).padStart(2, "0")} · {STEPS[step]}</div>
            <p>{CAPTIONS[step]}</p>
          </div>
        </aside>

        <div className="wz-main">
          <div className="setup-head">
            <div className="row">
              <div className="wordmark" style={{ fontSize: 16 }}><span className="mark"><Icon name="leaf" /></span>Procura</div>
              <div className="lab">Step {step + 1} of {STEPS.length} · {STEPS[step]}</div>
            </div>
            <div className="ob-dots" style={{ marginBottom: 0 }}>{STEPS.map((x, i) => <div key={x} className={`ob-dot ${i < step ? "done" : i === step ? "now" : ""}`} />)}</div>
          </div>

          <div className="setup-body">
            {step === 0 ? (
              <div className="ob-step" key="s0">
                <h2 className="ob-kick">Welcome{userName ? `, ${userName.split(" ")[0]}` : ""}. Let&apos;s set up your buyer</h2>
                <p className="ob-sub">A few answers so it knows how to shop for you. It takes about two minutes.</p>
                <div className="ob-grid2">
                  <div className="ob-field"><label htmlFor="co">Where you are</label><select id="co" className="ob-input" value={s.countryCode} onChange={(e) => set({ countryCode: e.target.value })}>{COUNTRIES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select></div>
                  <div className="ob-field"><label htmlFor="cu">Your currency</label><select id="cu" className="ob-input" value={s.currency} onChange={(e) => set({ currency: e.target.value })}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></div>
                </div>
                {s.currency !== "USD" ? <div className="callout info" style={{ marginBottom: 14 }}><Icon name="alert" /><div>Amazon search and Kite Passport sessions are priced in USD, so they work best if you budget in USD for now.</div></div> : null}
                <div className="wz-explain"><Icon name="shield" /><p>Your buyer is yours alone. It can search and compare for you, and it can only spend what you approve with your passkey.</p></div>
              </div>
            ) : null}

            {step === 1 ? (
              <div className="ob-step" key="s1">
                <h2 className="ob-kick">What do you usually shop for?</h2>
                <p className="ob-sub">Pick a few, so your buyer knows where to look first. You can change these later.</p>
                <div className="ob-chips">
                  {[...CATEGORIES, ...s.categories.filter((c) => !CATEGORIES.includes(c))].map((c) => (
                    <div key={c} role="checkbox" tabIndex={0} aria-checked={s.categories.includes(c)} className={`ob-chip ${s.categories.includes(c) ? "on" : ""}`} onClick={() => toggleCat(c)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleCat(c); } }}>
                      <span className="ck"><Icon name="check" strokeWidth={3} /></span>{c}
                    </div>
                  ))}
                </div>
                {err("categories")}
                <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                  <input className="ob-input" placeholder="Add your own category" aria-label="Custom category" value={custom} onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustom(); } }} />
                  <button type="button" className="btn btn-sec" onClick={addCustom}>Add</button>
                </div>
              </div>
            ) : null}

            {step === 2 ? (
              <div className="ob-step" key="s2">
                <h2 className="ob-kick">How should it choose?</h2>
                <p className="ob-sub">When several options meet your requirements, this is what your agent leans towards. Evidence and your limits always come first.</p>
                <div className="wz-choices" role="radiogroup" aria-label="How the agent chooses">
                  {CHOICES.map((c) => (
                    <div key={c.value} role="radio" tabIndex={0} aria-checked={s.quality === c.value} className={`wz-choice ${s.quality === c.value ? "on" : ""}`} onClick={() => set({ quality: c.value })}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); set({ quality: c.value }); } }}>
                      <b>{c.title}</b><span>{c.sub}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {step === 3 ? (
              <div className="ob-step" key="s3">
                <h2 className="ob-kick">Set the limits it can never pass</h2>
                <p className="ob-sub">Your agent can only spend inside these, and Kite Passport enforces its own session caps on top. Change them anytime.</p>
                {money("monthly", "Monthly limit")}
                <div className="ob-grid2">{money("single", "Largest single purchase")}{money("above", "Ask me above", "Every purchase")}</div>
                <div className="wz-explain">
                  <Icon name="shield" />
                  <p>
                    {above ? <>Purchases up to <b>{above} {s.currency}</b> still need your passkey, but the agent can prepare them without asking. </> : <>Every purchase needs your passkey. </>}
                    No session can be wider than <b>{single || "0"} {s.currency}</b> per payment, and the agent can never raise its own authority.
                  </p>
                </div>
              </div>
            ) : null}

            {step === 4 ? (
              <div className="ob-step" key="s4">
                <h2 className="ob-kick">Fund your agent</h2>
                <p className="ob-sub">Your agent pays from a Kite Passport wallet, inside limits you approve with your passkey. Link the wallet you will fund it from, so every purchase traces back to you.</p>
                <div className="card" style={{ padding: 18, display: "grid", gap: 12 }}>
                  <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                    <span style={{ color: "var(--forest-2)", flex: "none", width: 20, display: "flex" }}><Icon name="wallet" /></span>
                    <div>
                      <b style={{ fontSize: 14 }}>{wallet ? "Wallet linked" : "Connect your wallet"}</b>
                      <p style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.5, marginTop: 4 }}>
                        {wallet
                          ? <>Ownership proven for <b style={{ overflowWrap: "anywhere" }}>{shortAddress(wallet.address)}</b> on the {KITE_NETWORKS[DEFAULT_WALLET_CHAIN_ID].name}.</>
                          : "You sign a message to prove you control it. Signing moves no money, and Procura never holds your keys."}
                      </p>
                    </div>
                  </div>
                  {!wallet ? (
                    <button type="button" className="btn btn-pri" disabled={walletBusy} onClick={() => void connectWallet()} style={{ justifySelf: "start" }}>
                      <Icon name="wallet" /> {walletBusy ? "Waiting for your wallet…" : "Connect wallet"}
                    </button>
                  ) : null}
                  {walletErr ? <div role="alert" style={{ color: "var(--err)", fontSize: 12.5 }}>{walletErr}</div> : null}
                </div>
                <p className="mut3" style={{ fontSize: 12, marginTop: 12 }}>This is optional now. You can link or change it anytime in Settings, Wallets. Funding the agent itself happens later in Settings, Kite Passport.</p>
              </div>
            ) : null}

            {step === 5 ? (
              <div className="ob-step" key="s5">
                <div className="ob-agent-hero" style={{ paddingTop: 0 }}>
                  <div className="ob-orb-xl" style={{ width: 72, height: 72, borderRadius: 22 }}><Icon name="agent" /></div>
                  <h2 className="ob-kick">Your buyer is ready.</h2>
                  <p className="ob-sub" style={{ marginBottom: 0 }}>It can search for products and compare options now. It will never spend without your passkey, and never past the limits you set.</p>
                </div>
                <div className="ob-summary">
                  {[
                    ["Where",  `${COUNTRIES.find(([c]) => c === s.countryCode)?.[1] ?? s.countryCode} · ${s.currency}`],
                    ["Buys", s.categories.length ? s.categories.slice(0, 3).join(", ") + (s.categories.length > 3 ? ` +${s.categories.length - 3} more` : "") : "Not set"],
                    ["Chooses", CHOICES.find((c) => c.value === s.quality)?.title ?? "Balanced"],
                    ["Monthly limit", `${clean(s.monthly)} ${s.currency}`],
                    ["Largest purchase", `${single} ${s.currency}`],
                    ["Wallet", wallet ? shortAddress(wallet.address) : "Not linked yet"],
                  ].map(([l, v]) => <div key={l} className="ob-sum-row"><span className="mut">{l}</span><span className="v">{v}</span></div>)}
                </div>
                <button type="button" className="linkbtn" style={{ marginTop: 14, fontSize: 13.5 }} disabled={busy} onClick={() => finish("/requests/new")}>
                  Or describe my first purchase now <Icon name="arr" />
                </button>
              </div>
            ) : null}
          </div>

          <div className="setup-foot">
            <button className="btn btn-ghost" style={{ visibility: step === 0 || created ? "hidden" : "visible" }} disabled={busy} onClick={() => { setErrors({}); setStep(step - 1); }}><Icon name="prev" /> Back</button>
            <div style={{ flex: 1 }} />
            <button className="btn btn-pri btn-lg" disabled={busy || walletBusy} onClick={() => void next()}>
              {step === STEPS.length - 1 ? <><Icon name="bolt" /> {busy ? "Opening…" : "Go to Home"}</>
                : step === 3 ? <>{busy ? "Creating your buyer…" : "Create my buyer"} <Icon name="arr" /></>
                : step === 4 && !wallet ? <>Skip for now <Icon name="arr" /></>
                : <>Continue <Icon name="arr" /></>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
