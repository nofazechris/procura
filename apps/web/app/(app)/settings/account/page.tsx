"use client";

import { useEffect, useState } from "react";
import { useToast } from "@/components/overlays";
import { SettingsTabs } from "@/components/settings-tabs";
import { Async, DemoTag, PageHead } from "@/components/ui";
import { useApp, useCan } from "@/lib/app-context";
import { errorMessage, useBusinessDetail, useUpdateBusiness } from "@/lib/queries";
import { UpdateBusinessSchema } from "@procura/shared";

const CHOICES: ["Budget" | "Balanced" | "Premium", string][] = [["Budget", "Lowest price"], ["Balanced", "Balanced"], ["Premium", "Best reviewed"]];
const CATEGORIES = ["Electronics", "Home & kitchen", "Office & desk", "Tools & hardware", "Groceries & household", "Health & personal care", "Pets", "Gifts", "Books & media", "Sports & outdoors"];

/** Your account. The stored record is still called a business, but here it is just you and where things are delivered. */
export default function AccountSettingsPage() {
  const { mode, user } = useApp();
  const query = useBusinessDetail();
  const update = useUpdateBusiness();
  const can = useCan("business:update");
  const { show } = useToast();
  const [form, setForm] = useState({ name: "", address: "" });
  const [err, setErr] = useState<Record<string, string>>({});
  const d = query.data;
  useEffect(() => { if (d) setForm({ name: d.name, address: d.address ?? "" }); }, [d]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const parsed = UpdateBusinessSchema.safeParse(form);
    if (!parsed.success) { setErr({ name: "Enter at least two characters." }); return; }
    setErr({});
    try { await update.mutateAsync(parsed.data); show("Account saved"); } catch (e2) { show(errorMessage(e2), "err"); }
  }

  const prefs = (d?.preferences ?? {}) as { categories?: string[]; quality?: string };
  const [quality, setQuality] = useState<"Budget" | "Balanced" | "Premium">("Balanced");
  const [cats, setCats] = useState<string[]>([]);
  const [custom, setCustom] = useState("");
  useEffect(() => {
    if (!d) return;
    const q = (d.preferences as { quality?: string } | undefined)?.quality;
    setQuality(q === "Budget" || q === "Premium" ? q : "Balanced");
    setCats((d.preferences as { categories?: string[] } | undefined)?.categories ?? []);
  }, [d]);

  const pool = [...new Set([...CATEGORIES, ...cats])];
  const toggle = (c: string) => setCats((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]));
  const addCustom = () => { const c = custom.trim(); if (c && !cats.includes(c)) setCats((cur) => [...cur, c]); setCustom(""); };
  const changed = quality !== (prefs.quality === "Budget" || prefs.quality === "Premium" ? prefs.quality : "Balanced")
    || JSON.stringify([...cats].sort()) !== JSON.stringify([...(prefs.categories ?? [])].sort());
  async function savePrefs() {
    try { await update.mutateAsync({ preferences: { quality, categories: cats } }); show("Preferences saved"); } catch (e2) { show(errorMessage(e2), "err"); }
  }

  return (
    <>
      <PageHead title="Account" sub="You, where things are delivered, and how your buyer leans when options are close." />
      <SettingsTabs />
      <Async query={query}>
        {(b) => (
          <div className="two-col" style={{ alignItems: "start" }}>
            <form className="card" style={{ padding: 22 }} onSubmit={save} noValidate>
              <h2 style={{ fontSize: 16, marginBottom: 16 }}>About you {mode === "demo" ? <DemoTag>Demo</DemoTag> : null}</h2>
              <div className="fld"><label htmlFor="an">Name on orders</label><input id="an" className="input" value={form.name} disabled={!can} onChange={(e) => setForm({ ...form, name: e.target.value })} aria-invalid={!!err["name"]} />{err["name"] ? <div className="ferr">{err["name"]}</div> : null}</div>
              <div className="fld"><label>Signed in as</label><input className="input" value={user.email} disabled /></div>
              <div className="grid-2">
                <div className="fld"><label>Country</label><input className="input" value={b.countryCode} disabled /></div>
                <div className="fld"><label>Currency</label><input className="input" value={b.defaultCurrency} disabled /></div>
              </div>
              <div className="fld"><label htmlFor="aa">Delivery address</label><input id="aa" className="input" value={form.address} disabled={!can} placeholder="Where orders should arrive" onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
              <p className="mut3" style={{ fontSize: 12, marginBottom: 12 }}>Country and currency are fixed after setup, because they decide how amounts are compared.</p>
              {can ? <button className="btn btn-pri" type="submit" disabled={update.isPending}>{update.isPending ? "Saving…" : "Save changes"}</button> : <p className="mut3" style={{ fontSize: 12.5 }}>Only you can edit your account.</p>}
            </form>
            <div className="card" style={{ padding: 22 }}>
              <h2 style={{ fontSize: 16, marginBottom: 12 }}>How your buyer chooses</h2>
              <div className="eyebrow" style={{ marginBottom: 8 }}>When options are close</div>
              <div className="seg" role="radiogroup" aria-label="How your buyer chooses">
                {CHOICES.map(([v, l]) => (
                  <div key={v} role="radio" tabIndex={0} aria-checked={quality === v} className={`seg-i ${quality === v ? "on" : ""}`}
                    onClick={() => can && setQuality(v)} onKeyDown={(e) => { if (can && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); setQuality(v); } }}>{l}</div>
                ))}
              </div>
              <div className="eyebrow" style={{ margin: "18px 0 8px" }}>What you shop for</div>
              <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                {pool.map((c) => (
                  <button key={c} type="button" disabled={!can} aria-pressed={cats.includes(c)} onClick={() => toggle(c)}
                    className="chip" style={{ cursor: can ? "pointer" : "default", ...(cats.includes(c) ? { background: "var(--forest-2)", color: "#fff", borderColor: "var(--forest-2)" } : {}) }}>{c}</button>
                ))}
              </div>
              {can ? (
                <>
                  <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                    <input className="input" placeholder="Add your own" aria-label="Add a category" value={custom} onChange={(e) => setCustom(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustom(); } }} />
                    <button type="button" className="btn btn-sec" onClick={addCustom}>Add</button>
                  </div>
                  <button className="btn btn-pri" style={{ marginTop: 16 }} disabled={!changed || update.isPending} onClick={() => void savePrefs()}>{update.isPending ? "Saving…" : "Save preferences"}</button>
                </>
              ) : null}
            </div>
          </div>
        )}
      </Async>
    </>
  );
}
