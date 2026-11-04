"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, ApiClientError } from "@/lib/api-client";
import { decimalString } from "@procura/shared";
import { Icon } from "./icon";
import { ToastProvider, useToast } from "./overlays";

const STEPS = ["Business", "Requirements", "Preferences", "Financials", "Your agent"];
const INDUSTRIES = ["Restaurant", "Hotel", "Catering", "Food service", "Retail", "Other"];
const SIZES = ["1-10", "11-50", "51-200", "200+"];
const COUNTRIES: [string, string][] = [["NG", "Nigeria"], ["GH", "Ghana"], ["KE", "Kenya"], ["ZA", "South Africa"], ["GB", "United Kingdom"], ["US", "United States"], ["AE", "United Arab Emirates"], ["IN", "India"], ["CA", "Canada"]];
const CURRENCIES = ["USD", "NGN", "GBP", "EUR", "GHS", "KES", "ZAR"];
const CATEGORIES = ["Food & ingredients", "Beverages", "Packaging", "Cleaning & sanitation", "Equipment", "Office supplies", "Electronics", "Raw materials", "Professional services"];

interface State {
  name: string; industry: string; countryCode: string; currency: string; size: string; website: string;
  categories: string[]; quality: "Budget" | "Balanced" | "Premium"; frequency: string; delivery: "Fastest" | "Cheapest" | "Balanced"; suppliers: string;
  monthly: string; single: string; above: string;
}

/**
 * First-run setup, shown as a modal over the dashboard until the business exists. It cannot be
 * dismissed: nothing in the product works without a business and its spending limits.
 */
export function SetupWizard({ userName }: { userName: string }) {
  return <ToastProvider><Wizard userName={userName} /></ToastProvider>;
}

function Wizard({ userName }: { userName: string }) {
  const router = useRouter();
  const { show } = useToast();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [custom, setCustom] = useState("");
  const [s, setS] = useState<State>({
    name: "", industry: "Restaurant", countryCode: "NG", currency: "USD", size: "11-50", website: "",
    categories: [], quality: "Balanced", frequency: "Weekly", delivery: "Balanced", suppliers: "",
    monthly: "20000", single: "2500", above: "500",
  });
  const set = (patch: Partial<State>) => setS((cur) => ({ ...cur, ...patch }));

  // The company name typed at sign-up is carried over.
  useEffect(() => {
    try { const c = sessionStorage.getItem("procura_signup_company"); if (c) setS((cur) => (cur.name ? cur : { ...cur, name: c })); } catch { /* ignore */ }
  }, []);

  const clean = (v: string) => v.replace(/,/g, "").trim();

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (step === 0) {
      if (s.name.trim().length < 2) e["name"] = "Enter your business name.";
      if (s.website.trim() && !/^https?:\/\/\S+\.\S+/.test(s.website.trim())) e["website"] = "Enter a full address such as https://example.com, or leave it empty.";
    }
    if (step === 1 && s.categories.length === 0) e["categories"] = "Select at least one category.";
    if (step === 3) {
      if (!decimalString.safeParse(clean(s.monthly)).success || Number(clean(s.monthly)) <= 0) e["monthly"] = "Enter a monthly budget such as 20000.";
      if (!decimalString.safeParse(clean(s.single)).success || Number(clean(s.single)) <= 0) e["single"] = "Enter a maximum such as 2500.";
      if (!e["monthly"] && !e["single"] && Number(clean(s.single)) > Number(clean(s.monthly))) e["single"] = "This cannot exceed the monthly budget.";
      if (s.above.trim() && !decimalString.safeParse(clean(s.above)).success) e["above"] = "Enter an amount, or leave empty to approve every order.";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function finish() {
    setBusy(true);
    try {
      await api("/business", {
        method: "POST",
        body: {
          name: s.name.trim(), industry: s.industry, countryCode: s.countryCode, defaultCurrency: s.currency,
          ...(s.website.trim() ? { website: s.website.trim() } : {}),
          monthlyBudget: clean(s.monthly), maxSinglePurchase: clean(s.single), ...(s.above.trim() ? { approvalRequiredAbove: clean(s.above) } : {}),
          preferences: { size: s.size, categories: s.categories, quality: s.quality, frequency: s.frequency, delivery: s.delivery, preferredSuppliers: s.suppliers.trim() },
        },
      });
      try { sessionStorage.removeItem("procura_signup_company"); } catch { /* ignore */ }
      // The layout now finds a business, so the real dashboard replaces this frame.
      router.refresh();
    } catch (err) {
      setBusy(false);
      show(err instanceof ApiClientError ? err.message : "We could not set up your business. Please try again.", "err");
    }
  }

  const next = () => { if (!validate()) return; if (step < STEPS.length - 1) setStep(step + 1); else void finish(); };
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

  return (
    <div className="overlay on" style={{ zIndex: 150 }}>
      <div className="modal setup-modal" role="dialog" aria-modal="true" aria-label="Set up your business">
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
              <h2 className="ob-kick">Welcome{userName ? `, ${userName.split(" ")[0]}` : ""}. Let&apos;s set up your business</h2>
              <p className="ob-sub">A few quick answers help Procura tailor sourcing and spending to how you operate.</p>
              <div className="ob-field"><label htmlFor="bn">Business name</label><input id="bn" className="ob-input" value={s.name} onChange={(e) => set({ name: e.target.value })} aria-invalid={!!errors["name"]} autoFocus />{err("name")}</div>
              <div className="ob-field"><label>Industry</label>{seg(INDUSTRIES, s.industry, (v) => set({ industry: v }), "Industry")}</div>
              <div className="ob-grid2">
                <div className="ob-field"><label htmlFor="co">Country</label><select id="co" className="ob-input" value={s.countryCode} onChange={(e) => set({ countryCode: e.target.value })}>{COUNTRIES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select></div>
                <div className="ob-field"><label htmlFor="cu">Default currency</label><select id="cu" className="ob-input" value={s.currency} onChange={(e) => set({ currency: e.target.value })}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></div>
              </div>
              <div className="ob-field"><label>Business size <span className="hint">team members</span></label>{seg(SIZES, s.size, (v) => set({ size: v }), "Business size")}</div>
              <div className="ob-field"><label htmlFor="web">Website <span className="hint">optional</span></label><input id="web" className="ob-input" placeholder="https://northstarkitchen.com" value={s.website} onChange={(e) => set({ website: e.target.value })} aria-invalid={!!errors["website"]} />{err("website")}</div>
            </div>
          ) : null}

          {step === 1 ? (
            <div className="ob-step" key="s1">
              <h2 className="ob-kick">What do you buy regularly?</h2>
              <p className="ob-sub">Select the categories Procura should source for. You can refine these later.</p>
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
              <h2 className="ob-kick">Your purchasing preferences</h2>
              <p className="ob-sub">How Procura should weigh its recommendations when offers are close.</p>
              <div className="ob-field"><label>Quality priority</label>{seg(["Budget", "Balanced", "Premium"] as const, s.quality, (v) => set({ quality: v }), "Quality priority")}</div>
              <div className="ob-field"><label>Purchasing frequency</label>{seg(["Weekly", "Fortnightly", "Monthly", "Ad hoc"] as const, s.frequency as "Weekly", (v) => set({ frequency: v }), "Frequency")}</div>
              <div className="ob-field"><label>Delivery preference</label>{seg(["Fastest", "Cheapest", "Balanced"] as const, s.delivery, (v) => set({ delivery: v }), "Delivery preference")}</div>
              <div className="ob-field"><label htmlFor="ps">Preferred suppliers <span className="hint">optional, comma separated</span></label><input id="ps" className="ob-input" placeholder="Meridian Wholesale, Atlas Food Distribution" value={s.suppliers} onChange={(e) => set({ suppliers: e.target.value })} /></div>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="ob-step" key="s3">
              <h2 className="ob-kick">Set your financial guardrails</h2>
              <p className="ob-sub">Procura can only ever spend within these limits. Change them anytime. You will connect Kite Passport later, when you first authorise a payment.</p>
              {money("monthly", "Monthly procurement budget")}
              <div className="ob-grid2">{money("single", "Maximum single purchase")}{money("above", "Require approval above", "Every order")}</div>
              <div className="card" style={{ padding: 16, display: "flex", gap: 12, alignItems: "flex-start", marginTop: 4 }}>
                <span style={{ color: "var(--forest-2)", flex: "none", width: 18, display: "flex" }}><Icon name="shield" /></span>
                <p style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.5 }}>Procura enforces these limits itself, and Kite Passport enforces its own session limits separately. Your agent can never raise its own authority.</p>
              </div>
            </div>
          ) : null}

          {step === 4 ? (
            <div className="ob-step" key="s4">
              <div className="ob-agent-hero" style={{ paddingTop: 0 }}>
                <div className="ob-orb-xl" style={{ width: 72, height: 72, borderRadius: 22 }}><Icon name="spark" /></div>
                <h2 className="ob-kick">Your procurement assistant is ready.</h2>
                <p className="ob-sub" style={{ marginBottom: 0 }}>Procura can now source products, evaluate suppliers and organise your purchasing, within the authority you set.</p>
              </div>
              <div className="ob-summary">
                {[
                  ["Business", `${s.name} · ${s.industry}`],
                  ["Location", `${COUNTRIES.find(([c]) => c === s.countryCode)?.[1] ?? s.countryCode} · ${s.currency}`],
                  ["Buys", s.categories.length ? s.categories.slice(0, 3).join(", ") + (s.categories.length > 3 ? ` +${s.categories.length - 3} more` : "") : "Not set"],
                  ["Monthly budget", `${clean(s.monthly)} ${s.currency}`],
                  ["Max single purchase", `${clean(s.single)} ${s.currency}`],
                ].map(([l, v]) => <div key={l} className="ob-sum-row"><span className="mut">{l}</span><span className="v">{v}</span></div>)}
              </div>
            </div>
          ) : null}
        </div>

        <div className="setup-foot">
          <button className="btn btn-ghost" style={{ visibility: step === 0 ? "hidden" : "visible" }} disabled={busy} onClick={() => { setErrors({}); setStep(step - 1); }}><Icon name="prev" /> Back</button>
          <div style={{ flex: 1 }} />
          <button className="btn btn-pri btn-lg" disabled={busy} onClick={next}>
            {step === STEPS.length - 1 ? <><Icon name="bolt" /> {busy ? "Setting up…" : "Enter workspace"}</> : <>Continue <Icon name="arr" /></>}
          </button>
        </div>
      </div>
    </div>
  );
}
