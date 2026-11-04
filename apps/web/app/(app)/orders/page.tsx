"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Async, DemoTag, EmptyState, FilterChips, OrderStatusPill, PageHead } from "@/components/ui";
import { moneyShort, shortDate } from "@/lib/format";
import { useOrders } from "@/lib/queries";

const GROUPS: Record<string, string[] | null> = {
  All: null,
  "Pending approval": ["pending_approval"],
  Approved: ["approved", "awaiting_payment", "payment_pending"],
  Paid: ["paid", "processing"],
  Fulfilled: ["fulfilled"],
  Cancelled: ["cancelled", "failed", "disputed"],
};

export default function OrdersPage() {
  const orders = useOrders();
  const router = useRouter();
  const [filter, setFilter] = useState("All");
  const rows = useMemo(() => {
    const g = GROUPS[filter];
    return (orders.data ?? []).filter((o) => !g || g.includes(o.status));
  }, [orders.data, filter]);

  return (
    <>
      <PageHead title="Orders" sub="What you have bought, or are about to buy, through Procura." />
      <Async query={orders}>
        {(all) => all.length === 0 ? (
          <div className="card"><EmptyState icon="doc" title="No orders yet">Orders appear here after you pick an option from a comparison.</EmptyState></div>
        ) : (
          <>
            <FilterChips options={Object.keys(GROUPS)} value={filter} onChange={setFilter} />
            {rows.length === 0 ? <div className="card"><EmptyState icon="search" title="No orders in this view" /></div> : (
              <div className="tbl-wrap" data-tour="orders-table">
                <table className="tbl">
                  <thead><tr><th>Order</th><th>Seller</th><th>Request</th><th>Total</th><th>Status</th><th>Created</th></tr></thead>
                  <tbody>
                    {rows.map((o) => (
                      <tr key={o.id} className="row-link" onClick={() => router.push(`/orders/${o.id}`)}>
                        <td className="r-id">{o.orderNumber}</td>
                        <td><b>{o.supplierName}</b> {o.supplierSource === "demo" ? <DemoTag>Demo</DemoTag> : null}</td>
                        <td className="mut">{o.requestTitle}</td>
                        <td className="num">{moneyShort(o.totalAmount, o.currency)}</td>
                        <td><OrderStatusPill status={o.status} /></td>
                        <td className="mut num">{shortDate(o.createdAt)}</td>
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
