"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Icon } from "@/components/icon";
import { PaymentDetailBody } from "@/components/payment-detail";
import { Async, EmptyState, PageHead } from "@/components/ui";
import { useApp } from "@/lib/app-context";
import { usePayments } from "@/lib/queries";

export default function PaymentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { mode } = useApp();
  const payments = usePayments();
  return (
    <>
      <PageHead title="Payment" sub="One payment, exactly as recorded." actions={<Link href="/payments" className="btn btn-sec btn-sm"><Icon name="prev" /> All payments</Link>} />
      <Async query={payments}>
        {(rows) => {
          const p = rows.find((x) => x.id === id);
          return p ? <div className="card" style={{ padding: 22, maxWidth: 560 }}><PaymentDetailBody p={p} demo={mode === "demo"} /></div>
            : <div className="card"><EmptyState icon="card" title="Payment not found">It may belong to another business or no longer exist.</EmptyState></div>;
        }}
      </Async>
    </>
  );
}
