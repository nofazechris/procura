"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ExecutionTimeline } from "@/components/agent";
import { BudgetRing } from "@/components/charts";
import { Icon } from "@/components/icon";
import { Modal, useToast } from "@/components/overlays";
import { Async, DemoTag, PageHead, RequestStatusPill, SpecRow, SupplierLogo } from "@/components/ui";
import { useApp } from "@/lib/app-context";
import { describeActivity } from "@/lib/activity";
import { amount, minus, moneyShort, shortDate, timeOfDay } from "@/lib/format";
import { errorMessage, useActivity, useCancelRequest, useComparison, useOrders, useRequest, useStartSourcing } from "@/lib/queries";
import { stageProgress } from "@/lib/stages";

export default function WorkspacePage() {
  const { id } = useParams<{ id: string }>();
  const request = useRequest(id);
  return <Async query={request}>{(r) => <Workspace requestId={id} request={r} />}</Async>;
}

function Workspace({ requestId, request: r }: { requestId: string; request: NonNullable<ReturnType<typeof useRequest>["data"]> }) {
  const { mode } = useApp();
  const router = useRouter();
  const { show } = useToast();
  const sourcing = useStartSourcing();
  const cancel = useCancelRequest();
  const orders = useOrders();
  const activity = useActivity();
  const hasQuotes = r.status !== "draft";
  const comparison = useComparison(requestId);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const progress = stageProgress(r.status);
  const myOrders = (orders.data ?? []).filter((o) => o.requestId === requestId);
  const openOrder = myOrders.find((o) => o.status !== "cancelled" && o.status !== "failed");

  const log = useMemo(() => {
    const ids = new Set([requestId, ...myOrders.map((o) => o.id)]);
    return (activity.data ?? []).filter((a) => a.resourceId && ids.has(a.resourceId)).slice().reverse();
  }, [activity.data, requestId, myOrders]);

  const cmp = hasQuotes ? comparison.data?.comparison : undefined;
  const rec = cmp?.rows.find((x) => x.quoteId === cmp.recommendedQuoteId);
  const nameOf = (sid: string) => comparison.data?.suppliers.find((s) => s.id === sid)?.name ?? "Supplier";
  const eligibleCount = cmp?.rows.filter((x) => x.verdict === "eligible").length ?? 0;
  const reviewCount = cmp?.rows.filter((x) => x.verdict === "review_required").length ?? 0;
  const budgetNum = Number(amount(r.budgetAmount, 2).replace(/,/g, ""));
  const recNum = rec ? Number(amount(rec.totalCost, 2).replace(/,/g, "")) : 0;

  async function startSourcing() {
    try {
      await sourcing.mutateAsync(requestId);
      router.push(`/procurement/${requestId}/compare`);
    } catch (e) { show(errorMessage(e), "err"); }
  }

  async function doCancel() {
    try {
      await cancel.mutateAsync(requestId);
      setConfirmCancel(false);
      show("Procurement cancelled");
    } catch (e) { setConfirmCancel(false); show(errorMessage(e), "err"); }
  }

  const cancellable = !["completed", "cancelled", "failed", "processing"].includes(r.status);

  return (
    <>
      <PageHead
        eyebrow={<>{r.requestNumber} · {r.title}</>}
        title="Procurement workspace"
        sub="Agent command centre: sourcing, evidence and execution for this request."
        actions={<>
          {hasQuotes ? <Link href={`/procurement/${requestId}/compare`} className="btn btn-sec btn-sm"><Icon name="scale" /> View comparison</Link> : null}
          {cancellable ? <button className="btn btn-sec btn-sm" onClick={() => setConfirmCancel(true)}>Cancel procurement</button> : null}
        </>}
      />

      <div className="ws">
        <div className="ws-col">
          <div className="card ws-card">
            <h3>Requirements {mode === "demo" ? <DemoTag>Demo</DemoTag> : null}</h3>
            {r.items.map((it) => (
              <div key={it.id} className="item-line"><span>{it.productName}</span><span className="q">{amount(it.quantity, 0)} {it.unit}</span></div>
            ))}
          </div>
          <div className="card ws-card">
            <h3>Constraints <RequestStatusPill status={r.status} /></h3>
            <SpecRow label="Budget (delivered)" value={moneyShort(r.budgetAmount, r.currency)} />
            <SpecRow label="Deadline" value={r.deliveryDeadline ? shortDate(r.deliveryDeadline) : "Not set"} />
            <SpecRow label="Location" value={r.deliveryLocation ?? "Not set"} />
            <SpecRow label="Priority" value={r.priority[0]!.toUpperCase() + r.priority.slice(1)} />
            <SpecRow label="Currency" value={r.currency} />
          </div>
        </div>

        <div className="ws-col">
          <div className="card exec" data-tour="exec-card">
            <div className="exec-top"><h2>Agent execution</h2><span className="stage-prog num">Stage {Math.min(11, (progress.current ?? progress.done) + 1)} / 11</span></div>
            <ExecutionTimeline progress={progress} replay={mode === "demo" && r.status === "comparing"} />

            {rec ? (
              <div className="reason">
                <div className="rl"><Icon name="spark" /> Decision summary · deterministic comparison</div>
                <span>
                  <b>{nameOf(rec.supplierId)}</b> is recommended: the lowest total delivered price ({moneyShort(rec.totalCost, cmp!.currency)}) among
                  quotes that meet your requirements. {eligibleCount} of {cmp!.rows.length} {cmp!.rows.length === 1 ? "quote is" : "quotes are"} eligible
                  {reviewCount ? `, ${reviewCount} held for review because evidence is missing` : ""}.
                  {cmp!.estimatedSavings ? ` Estimated saving ${moneyShort(cmp!.estimatedSavings.amount, cmp!.currency)} against the highest eligible quote.` : ""}
                </span>
              </div>
            ) : hasQuotes && !comparison.isPending && cmp ? (
              <div className="reason"><div className="rl"><Icon name="alert" /> No recommendation</div>
                <span>{cmp.rows.length === 0 ? "No suppliers matched this request." : cmp.notes.join(" ")}</span></div>
            ) : null}

            <div style={{ marginTop: 18 }}>
              <div className="eyebrow" style={{ marginBottom: 8 }}>Activity log</div>
              {log.length === 0 ? <p className="mut3" style={{ fontSize: 12.5 }}>No recorded activity yet.</p> : log.map((a) => {
                const v = describeActivity(a);
                return <div key={a.id} className="logline"><span className="t num">{timeOfDay(a.createdAt)}</span><span>{v.title}{v.sub ? <> · <b>{v.sub}</b></> : null}</span></div>;
              })}
            </div>
            <p className="mut3" style={{ fontSize: 11.5, marginTop: 14 }}>
              {mode === "live" ? "Sourcing runs on the source you chose: live Amazon search through Kite Passport, or the demo supplier set." : "Demo: the stages replay on sample data."}
            </p>
          </div>
        </div>

        <div className="ws-col">
          <div className="card ws-card">
            <h3>Supplier shortlist</h3>
            {!hasQuotes ? <p className="mut" style={{ fontSize: 13 }}>No quotes yet. Start sourcing to find suppliers.</p>
              : comparison.isPending ? <p className="mut" style={{ fontSize: 13 }}>Loading…</p>
              : (cmp?.rows ?? []).length === 0 ? <p className="mut" style={{ fontSize: 13 }}>No suppliers matched.</p>
              : (cmp?.rows ?? []).map((row) => (
                <Link key={row.quoteId} href={`/suppliers/${row.supplierId}`} className={`short-i ${row.quoteId === cmp?.recommendedQuoteId ? "rec" : ""}`} style={{ textDecoration: "none", color: "inherit" }}>
                  <SupplierLogo name={nameOf(row.supplierId)} size={30} />
                  <div style={{ minWidth: 0 }}><div className="nm">{nameOf(row.supplierId)}</div><div className="mut3" style={{ fontSize: 11 }}>{row.deliveryDays ? `${row.deliveryDays} days` : "Delivery not stated"}</div></div>
                  <span className="pr num">{moneyShort(row.totalCost, row.currency)}</span>
                </Link>
              ))}
            {hasQuotes && (cmp?.rows ?? []).length > 0 ? <Link href={`/procurement/${requestId}/compare`} className="btn btn-sec btn-sm" style={{ width: "100%", marginTop: 6 }}>Compare all</Link> : null}
          </div>

          <div className="card ws-card">
            <h3>Budget status</h3>
            {rec ? (
              <div className="budget-ring">
                <BudgetRing used={recNum} total={budgetNum} />
                <div><div className="num" style={{ fontSize: 20, fontWeight: 800 }}>{moneyShort(rec.totalCost, cmp!.currency)}</div>
                  <div className="mut3" style={{ fontSize: 12 }}>of {moneyShort(r.budgetAmount, r.currency)} · {moneyShort(minus(r.budgetAmount, rec.totalCost), r.currency)} left</div></div>
              </div>
            ) : <p className="mut" style={{ fontSize: 13 }}>Budget {moneyShort(r.budgetAmount, r.currency)}. The delivered total of the recommended quote appears here.</p>}
          </div>

          <div className="card ws-card" style={{ borderLeft: "3px solid var(--warn)" }}>
            <h3><span style={{ display: "flex", alignItems: "center", gap: 8 }}><Icon name="alert" /> Next step</span></h3>
            {r.status === "draft" ? (
              <>
                <p className="mut" style={{ fontSize: 13 }}>This request has not been sourced yet.</p>
                <button className="btn btn-pri btn-sm" style={{ width: "100%", marginTop: 12 }} disabled={sourcing.isPending} onClick={() => void startSourcing()}>
                  <Icon name="bolt" /> {sourcing.isPending ? "Sourcing…" : "Start sourcing"}
                </button>
              </>
            ) : r.status === "comparing" ? (
              <>
                <p className="mut" style={{ fontSize: 13 }}>Review the comparison and select a supplier to prepare the purchase order.</p>
                <Link href={`/procurement/${requestId}/compare`} className="btn btn-pri btn-sm" style={{ width: "100%", marginTop: 12 }}>Review comparison <Icon name="arr" /></Link>
              </>
            ) : r.status === "awaiting_approval" ? (
              <>
                <p className="mut" style={{ fontSize: 13 }}>{openOrder ? `${openOrder.orderNumber} is waiting for your approval.` : "An order is waiting for your approval."}</p>
                <Link href="/approvals" className="btn btn-pri btn-sm" style={{ width: "100%", marginTop: 12 }}>Review approval <Icon name="arr" /></Link>
              </>
            ) : r.status === "approved" ? (
              <>
                <p className="mut" style={{ fontSize: 13 }}>Approved. Payment needs an approved Kite Passport spending session{mode === "live" ? ", which is not connected yet" : ""}.</p>
                {openOrder ? <Link href={`/orders/${openOrder.id}`} className="btn btn-sec btn-sm" style={{ width: "100%", marginTop: 12 }}>View purchase order</Link> : null}
              </>
            ) : <p className="mut" style={{ fontSize: 13 }}>{progress.note}</p>}
          </div>
        </div>
      </div>

      <Modal open={confirmCancel} onClose={() => setConfirmCancel(false)} label="Cancel procurement">
        <div className="modal-body" style={{ textAlign: "left" }}>
          <h3>Cancel this procurement?</h3>
          <p>{r.requestNumber} · {r.title} will be stopped. You can always create a new request.</p>
        </div>
        <div className="modal-foot">
          <button className="btn btn-sec" style={{ flex: 1 }} onClick={() => setConfirmCancel(false)}>Keep it</button>
          <button className="btn btn-forest" style={{ flex: 1 }} disabled={cancel.isPending} onClick={() => void doCancel()}>{cancel.isPending ? "Cancelling…" : "Cancel procurement"}</button>
        </div>
      </Modal>
    </>
  );
}
