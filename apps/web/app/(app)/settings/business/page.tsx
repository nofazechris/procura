"use client";

import { useEffect, useState } from "react";
import { useToast } from "@/components/overlays";
import { SettingsTabs } from "@/components/settings-tabs";
import { Async, DemoTag, PageHead, SpecRow } from "@/components/ui";
import { useApp, useCan } from "@/lib/app-context";
import { errorMessage, useBusinessDetail, useUpdateBusiness } from "@/lib/queries";
import { UpdateBusinessSchema } from "@procura/shared";

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
  const choice = prefs.quality === "Budget" ? "Lowest price" : prefs.quality === "Premium" ? "Best reviewed" : prefs.quality === "Balanced" ? "Balanced" : "Not set";

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
              <SpecRow label="When options are close" value={choice} />
              <div className="eyebrow" style={{ margin: "16px 0 8px" }}>What you shop for</div>
              <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                {(prefs.categories ?? []).length === 0 ? <span className="mut3" style={{ fontSize: 13 }}>None selected</span> : prefs.categories!.map((c) => <span key={c} className="chip">{c}</span>)}
              </div>
              <p className="mut3" style={{ fontSize: 12, marginTop: 14 }}>These came from setup. Editing them arrives in a later update.</p>
            </div>
          </div>
        )}
      </Async>
    </>
  );
}
