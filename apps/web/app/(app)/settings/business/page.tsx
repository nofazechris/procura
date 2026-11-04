"use client";

import { useEffect, useState } from "react";
import { useToast } from "@/components/overlays";
import { SettingsTabs } from "@/components/settings-tabs";
import { Async, DemoTag, PageHead, SpecRow } from "@/components/ui";
import { useApp, useCan } from "@/lib/app-context";
import { errorMessage, useBusinessDetail, useUpdateBusiness } from "@/lib/queries";
import { UpdateBusinessSchema } from "@procura/shared";

export default function BusinessSettingsPage() {
  const { mode } = useApp();
  const query = useBusinessDetail();
  const update = useUpdateBusiness();
  const can = useCan("business:update");
  const { show } = useToast();
  const [form, setForm] = useState({ name: "", industry: "", website: "", address: "" });
  const [err, setErr] = useState<Record<string, string>>({});
  const d = query.data;
  useEffect(() => { if (d) setForm({ name: d.name, industry: d.industry ?? "", website: d.website ?? "", address: d.address ?? "" }); }, [d]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const parsed = UpdateBusinessSchema.safeParse(form);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const i of parsed.error.issues) next[String(i.path[0] ?? "form")] = i.path[0] === "website" ? "Enter a full address such as https://example.com, or leave it empty." : "Please check this field.";
      setErr(next);
      return;
    }
    setErr({});
    try { await update.mutateAsync(parsed.data); show("Business profile saved"); } catch (e2) { show(errorMessage(e2), "err"); }
  }

  const prefs = (d?.preferences ?? {}) as { categories?: string[]; quality?: string; frequency?: string; delivery?: string; preferredSuppliers?: string };

  return (
    <>
      <PageHead title="Business settings" sub="Company profile and purchasing preferences." />
      <SettingsTabs />
      <Async query={query}>
        {(b) => (
          <div className="two-col" style={{ alignItems: "start" }}>
            <form className="card" style={{ padding: 22 }} onSubmit={save} noValidate>
              <h2 style={{ fontSize: 16, marginBottom: 16 }}>Business profile {mode === "demo" ? <DemoTag>Demo</DemoTag> : null}</h2>
              <div className="fld"><label htmlFor="bn">Company name</label><input id="bn" className="input" value={form.name} disabled={!can} onChange={(e) => setForm({ ...form, name: e.target.value })} aria-invalid={!!err["name"]} />{err["name"] ? <div className="ferr">{err["name"]}</div> : null}</div>
              <div className="fld"><label htmlFor="bi">Industry</label><input id="bi" className="input" value={form.industry} disabled={!can} onChange={(e) => setForm({ ...form, industry: e.target.value })} /></div>
              <div className="grid-2">
                <div className="fld"><label>Country</label><input className="input" value={b.countryCode} disabled /></div>
                <div className="fld"><label>Default currency</label><input className="input" value={b.defaultCurrency} disabled /></div>
              </div>
              <div className="fld"><label htmlFor="bw">Website</label><input id="bw" className="input" value={form.website} disabled={!can} placeholder="https://" onChange={(e) => setForm({ ...form, website: e.target.value })} aria-invalid={!!err["website"]} />{err["website"] ? <div className="ferr">{err["website"]}</div> : null}</div>
              <div className="fld"><label htmlFor="ba">Address</label><input id="ba" className="input" value={form.address} disabled={!can} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
              <p className="mut3" style={{ fontSize: 12, marginBottom: 12 }}>Country and currency are fixed after setup, because they define how amounts are compared.</p>
              {can ? <button className="btn btn-pri" type="submit" disabled={update.isPending}>{update.isPending ? "Saving…" : "Save changes"}</button> : <p className="mut3" style={{ fontSize: 12.5 }}>Only owners and admins can edit the business profile.</p>}
            </form>
            <div className="card" style={{ padding: 22 }}>
              <h2 style={{ fontSize: 16, marginBottom: 12 }}>Purchasing preferences</h2>
              <SpecRow label="Quality priority" value={prefs.quality ?? "Not set"} />
              <SpecRow label="Delivery" value={prefs.delivery ?? "Not set"} />
              <SpecRow label="Frequency" value={prefs.frequency ?? "Not set"} />
              <SpecRow label="Preferred suppliers" value={prefs.preferredSuppliers || "None"} />
              <div className="eyebrow" style={{ margin: "16px 0 8px" }}>Categories</div>
              <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                {(prefs.categories ?? []).length === 0 ? <span className="mut3" style={{ fontSize: 13 }}>None selected</span> : prefs.categories!.map((c) => <span key={c} className="chip">{c}</span>)}
              </div>
              <p className="mut3" style={{ fontSize: 12, marginTop: 14 }}>These came from onboarding and guide how Procura ranks close offers. Editing them arrives in a later update.</p>
            </div>
          </div>
        )}
      </Async>
    </>
  );
}
