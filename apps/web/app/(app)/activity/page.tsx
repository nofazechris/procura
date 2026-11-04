"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Icon } from "@/components/icon";
import { Async, EmptyState, FilterChips, PageHead } from "@/components/ui";
import { describeActivity } from "@/lib/activity";
import { dateTime } from "@/lib/format";
import { useActivity } from "@/lib/queries";

const FILTERS = ["All", "Procurement", "Supplier", "Payment", "Approval", "Agent", "Security"];

export default function ActivityPage() {
  const activity = useActivity();
  const [filter, setFilter] = useState("All");
  const rows = useMemo(() => (activity.data ?? []).map((a) => ({ a, v: describeActivity(a) })).filter((r) => filter === "All" || r.v.category === filter), [activity.data, filter]);

  return (
    <>
      <PageHead title="Activity" sub="A transparent, traceable record of procurement operations and agent actions." />
      <Async query={activity}>
        {(all) => all.length === 0 ? (
          <div className="card"><EmptyState icon="clock" title="No activity yet">Every instruction, decision and approval is recorded here as it happens.</EmptyState></div>
        ) : (
          <>
            <FilterChips options={FILTERS} value={filter} onChange={setFilter} />
            {rows.length === 0 ? <div className="card"><EmptyState icon="search" title={`No ${filter.toLowerCase()} activity`} /></div> : (
              <div className="card" style={{ padding: "8px 20px" }}>
                {rows.map(({ a, v }) => (
                  <Link key={a.id} href={v.href} className="feed-i" style={{ textDecoration: "none", color: "inherit" }}>
                    <div className="feed-dot" style={v.ok ? { background: "var(--ok-bg)", color: "var(--ok)" } : undefined}><Icon name={v.icon} /></div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="ft" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <b>{v.title}</b><span className="chip" style={{ fontSize: 10, padding: "2px 7px" }}>{v.category}</span>
                      </div>
                      <div className="fs">{[v.sub, a.actorName ?? (a.actorType === "system" ? "System" : a.actorType === "agent" ? "Agent" : "")].filter(Boolean).join(" · ")}</div>
                    </div>
                    <div className="mut3 num" style={{ fontSize: 12, whiteSpace: "nowrap" }}>{dateTime(a.createdAt)}</div>
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
