"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Icon } from "@/components/icon";
import { Async, DemoTag, EmptyState, FilterChips, PageHead, SupplierLogo } from "@/components/ui";
import { shortDate } from "@/lib/format";
import { useSuppliers } from "@/lib/queries";
import { SupplierStatePill, supplierState } from "@/components/supplier-state";

export default function SuppliersPage() {
  const suppliers = useSuppliers();
  const [filter, setFilter] = useState("All suppliers");
  const [q, setQ] = useState("");

  const categories = useMemo(() => {
    const count = new Map<string, number>();
    for (const s of suppliers.data ?? []) for (const c of s.categories) count.set(c, (count.get(c) ?? 0) + 1);
    return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([c]) => c);
  }, [suppliers.data]);

  const options = ["All suppliers", "Verified", "Review required", ...categories.map((c) => c[0]!.toUpperCase() + c.slice(1))];

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (suppliers.data ?? []).filter((s) => {
      if (needle && !`${s.name} ${s.city ?? ""}`.toLowerCase().includes(needle)) return false;
      if (filter === "All suppliers") return true;
      if (filter === "Verified") return supplierState(s) === "verified";
      if (filter === "Review required") return ["review", "partial", "unverified"].includes(supplierState(s));
      return s.categories.some((c) => c.toLowerCase() === filter.toLowerCase());
    });
  }, [suppliers.data, filter, q]);

  return (
    <>
      <PageHead title="Suppliers" sub="Vendors discovered for your business. Evidence over confidence: unknown is never shown as verified." />
      <Async query={suppliers}>
        {(all) => all.length === 0 ? (
          <div className="card"><EmptyState icon="users" title="No suppliers yet" action={<Link href="/procurement/new" className="btn btn-pri"><Icon name="plus" /> Start a procurement</Link>}>
            Suppliers appear here when Procura discovers them for a request.
          </EmptyState></div>
        ) : (
          <>
            <FilterChips options={options} value={filter} onChange={setFilter} />
            <div style={{ position: "relative", maxWidth: 320, marginBottom: 16 }}>
              <input className="input" style={{ paddingLeft: 34 }} placeholder="Search suppliers" aria-label="Search suppliers" value={q} onChange={(e) => setQ(e.target.value)} />
              <span style={{ position: "absolute", left: 11, top: 10, color: "var(--ink-3)", display: "flex" }}><Icon name="search" /></span>
            </div>
            {rows.length === 0 ? <div className="card"><EmptyState icon="search" title="No matching suppliers">Try a different filter or search.</EmptyState></div> : (
              <div className="grid-3">
                {rows.map((s) => (
                  <Link key={s.id} href={`/suppliers/${s.id}`} className="card" style={{ padding: 18, textDecoration: "none", color: "inherit" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                      <SupplierLogo name={s.name} size={40} />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 14.5 }}>{s.name}</div>
                        <div className="mut3" style={{ fontSize: 12 }}>{[s.city, s.countryCode].filter(Boolean).join(", ") || "Location not stated"}</div>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
                      {s.categories.map((c) => <span key={c} className="chip" style={{ padding: "3px 9px", fontSize: 11 }}>{c}</span>)}
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
                      <SupplierStatePill state={supplierState(s)} />
                      {s.sourceType === "demo" ? <DemoTag>Demo</DemoTag> : <span className="mut3" style={{ fontSize: 11.5 }}>Added {shortDate(s.createdAt)}</span>}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </>
        )}
      </Async>
    </>
  );
}
