"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Icon } from "@/components/icon";
import { Async, EmptyState, FilterChips, PageHead, RequestStatusPill } from "@/components/ui";
import { moneyShort, shortDate } from "@/lib/format";
import { useRequests } from "@/lib/queries";

const GROUPS: Record<string, string[] | null> = {
  All: null,
  Draft: ["draft"],
  Sourcing: ["submitted", "analysing", "sourcing"],
  Comparing: ["comparing"],
  "Awaiting approval": ["awaiting_approval"],
  Approved: ["approved", "processing"],
  Completed: ["completed"],
  Cancelled: ["cancelled", "failed"],
};

export default function ProcurementPage() {
  const router = useRouter();
  const requests = useRequests();
  const [filter, setFilter] = useState("All");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"new" | "old" | "budget">("new");

  const rows = useMemo(() => {
    const group = GROUPS[filter];
    const needle = q.trim().toLowerCase();
    const list = (requests.data ?? [])
      .filter((r) => (!group || group.includes(r.status)) && (!needle || `${r.title} ${r.requestNumber}`.toLowerCase().includes(needle)));
    return [...list].sort((a, b) =>
      sort === "budget" ? Number(b.budgetAmount) - Number(a.budgetAmount)
        : sort === "old" ? a.createdAt.localeCompare(b.createdAt) : b.createdAt.localeCompare(a.createdAt));
  }, [requests.data, filter, q, sort]);

  return (
    <>
      <PageHead title="Requests" sub="Everything you have asked Procura to find, from the first search to the order."
        actions={<Link href="/requests/new" className="btn btn-pri"><Icon name="plus" /> Create request</Link>} />
      <Async query={requests}>
        {(all) => (
          <>
            <FilterChips options={Object.keys(GROUPS)} value={filter} onChange={setFilter} />
            <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
              <div style={{ position: "relative", flex: "1 1 220px", maxWidth: 320 }}>
                <input className="input" style={{ paddingLeft: 34 }} placeholder="Search requests" aria-label="Search requests" value={q} onChange={(e) => setQ(e.target.value)} />
                <span style={{ position: "absolute", left: 11, top: 10, color: "var(--ink-3)", display: "flex" }}><Icon name="search" /></span>
              </div>
              <select className="input" style={{ width: 170 }} aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
                <option value="new">Newest first</option><option value="old">Oldest first</option><option value="budget">Highest budget</option>
              </select>
            </div>
            {all.length === 0 ? (
              <div className="card"><EmptyState icon="pkg" title="No requests yet" action={<Link href="/requests/new" className="btn btn-pri"><Icon name="plus" /> Create your first request</Link>}>
                Describe what you need and Procura will find options and compare them.
              </EmptyState></div>
            ) : rows.length === 0 ? (
              <div className="card"><EmptyState icon="search" title="No matching requests">Try another filter or search term.</EmptyState></div>
            ) : (
              <div className="tbl-wrap" data-tour="requests-table">
                <table className="tbl">
                  <thead><tr><th>Request ID</th><th>Description</th><th>Requested by</th><th>Budget</th><th>Status</th><th>Created</th><th /></tr></thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} className="row-link" onClick={() => router.push(r.status === "comparing" || r.status === "awaiting_approval" ? `/requests/${r.id}/compare` : `/requests/${r.id}`)}>
                        <td className="r-id">{r.requestNumber}</td>
                        <td><b>{r.title}</b></td>
                        <td className="mut">{r.requestedByName ?? "-"}</td>
                        <td className="num">{moneyShort(r.budgetAmount, r.currency)}</td>
                        <td><RequestStatusPill status={r.status} /></td>
                        <td className="mut num">{shortDate(r.createdAt)}</td>
                        <td style={{ textAlign: "right" }}><Link href={`/requests/${r.id}`} className="btn btn-ghost btn-sm" onClick={(e) => e.stopPropagation()}>Open</Link></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </Async>
    </>
  );
}
