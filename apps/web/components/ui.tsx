"use client";

import Link from "next/link";
import type { UseQueryResult } from "@tanstack/react-query";
import type { CSSProperties, ReactNode } from "react";
import type { PaymentStatus, PurchaseOrderStatus, RequestStatus } from "@procura/shared";
import { errorMessage } from "@/lib/queries";
import { Icon, type IconName } from "./icon";

/* ---------- status vocabulary ---------- */

type Tone = "ok" | "warn" | "err" | "info" | "mute";

const REQUEST_LABEL: Record<RequestStatus, [string, Tone]> = {
  draft: ["Draft", "mute"], submitted: ["Submitted", "info"], analysing: ["Analysing", "info"], sourcing: ["Searching", "info"],
  comparing: ["Comparing", "info"], awaiting_approval: ["Awaiting approval", "warn"], approved: ["Approved", "ok"],
  processing: ["Processing", "info"], completed: ["Completed", "ok"], failed: ["Failed", "err"], cancelled: ["Cancelled", "err"],
};

const ORDER_LABEL: Record<PurchaseOrderStatus, [string, Tone]> = {
  draft: ["Draft", "mute"], pending_approval: ["Pending approval", "warn"], approved: ["Approved", "ok"],
  awaiting_payment: ["Awaiting payment", "warn"], payment_pending: ["Payment pending", "info"], paid: ["Paid", "ok"],
  processing: ["Processing", "info"], fulfilled: ["Fulfilled", "ok"], disputed: ["Disputed", "err"],
  cancelled: ["Cancelled", "err"], failed: ["Failed", "err"],
};

const PAYMENT_LABEL: Record<PaymentStatus, [string, Tone]> = {
  prepared: ["Prepared", "mute"], awaiting_authorisation: ["Awaiting authorisation", "warn"], authorised: ["Authorised", "info"],
  submitted: ["Submitted", "info"], pending: ["Pending", "info"], confirmed: ["Confirmed", "ok"], failed: ["Failed", "err"],
  cancelled: ["Cancelled", "mute"],
};

export const requestLabel = (s: RequestStatus) => REQUEST_LABEL[s]?.[0] ?? s;

export function Pill({ tone, children, small }: { tone: Tone; children: ReactNode; small?: boolean }) {
  return (
    <span className={`pill p-${tone}`} style={small ? { fontSize: 10, padding: "2px 7px" } : undefined}>
      <span className="dot" />{children}
    </span>
  );
}

export function RequestStatusPill({ status }: { status: RequestStatus }) {
  const [label, tone] = REQUEST_LABEL[status] ?? [status, "mute" as Tone];
  return <Pill tone={tone}>{label}</Pill>;
}
export function OrderStatusPill({ status }: { status: PurchaseOrderStatus }) {
  const [label, tone] = ORDER_LABEL[status] ?? [status, "mute" as Tone];
  return <Pill tone={tone}>{label}</Pill>;
}
export function PaymentStatusPill({ status }: { status: PaymentStatus }) {
  const [label, tone] = PAYMENT_LABEL[status] ?? [status, "mute" as Tone];
  return <Pill tone={tone}>{label}</Pill>;
}

/** Fictional demo sellers must always be labelled (Technical PRD s9.2). */
export function DemoTag({ children = "Demo data" }: { children?: ReactNode }) {
  return <span className="demo-tag">{children}</span>;
}

/* ---------- layout ---------- */

export function PageHead({ title, sub, eyebrow, actions }: { title: ReactNode; sub?: ReactNode; eyebrow?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="phead">
      <div>
        {eyebrow ? <div className="eyebrow" style={{ marginBottom: 8 }}>{eyebrow}</div> : null}
        <h1>{title}</h1>
        {sub ? <p>{sub}</p> : null}
      </div>
      {actions ? <div className="acts">{actions}</div> : null}
    </div>
  );
}

export function Kpi({ label, value, icon, tone, sub }: { label: string; value: ReactNode; icon: IconName; tone?: "up" | "down"; sub: ReactNode }) {
  const arrow = tone === "up" ? "↑ " : tone === "down" ? "↓ " : "";
  return (
    <div className="kpi card">
      <div className="k-top"><span className="k-lbl">{label}</span><span className="k-ic"><Icon name={icon} /></span></div>
      <div className="k-val num">{value}</div>
      <div className="k-delta"><span className={tone === "up" ? "k-up" : tone === "down" ? "k-down" : ""}>{arrow}{sub}</span></div>
    </div>
  );
}

/* ---------- states (Technical PRD s17.2: loading, error, empty, retry) ---------- */

export function EmptyState({ icon = "inbox", title, children, action }: { icon?: IconName; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-ic"><Icon name={icon} /></div>
      <h3>{title}</h3>
      {children ? <p>{children}</p> : null}
      {action ? <div style={{ marginTop: 16 }}>{action}</div> : null}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="empty" role="alert">
      <div className="empty-ic" style={{ background: "var(--err-bg)", color: "var(--err)" }}><Icon name="alert" /></div>
      <h3>We could not load this</h3>
      <p>{errorMessage(error)}</p>
      {onRetry ? <div style={{ marginTop: 16 }}><button className="btn btn-sec btn-sm" onClick={onRetry}>Try again</button></div> : null}
    </div>
  );
}

export function Skeleton({ h = 16, w = "100%", style }: { h?: number; w?: number | string; style?: CSSProperties }) {
  return <div className="skel" style={{ height: h, width: w, ...style }} aria-hidden="true" />;
}

export function PageSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading">
      <Skeleton h={30} w={240} style={{ marginBottom: 10 }} />
      <Skeleton h={14} w={360} style={{ marginBottom: 28 }} />
      <div className="card" style={{ padding: 18 }}>
        {Array.from({ length: rows }).map((_, i) => <Skeleton key={i} h={18} style={{ marginBottom: 16 }} />)}
      </div>
    </div>
  );
}

/** Renders loading, error (with retry) and the data. Every screen goes through this. */
export function Async<T>({ query, children, skeleton }: { query: UseQueryResult<T>; children: (data: T) => ReactNode; skeleton?: ReactNode }) {
  if (query.isPending) return <>{skeleton ?? <PageSkeleton />}</>;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  return <>{children(query.data)}</>;
}

/* ---------- small pieces ---------- */

export function SupplierLogo({ name, size = 34 }: { name: string; size?: number }) {
  const colors = ["#3C72AE", "#248257", "#B4790F", "#7B61A8", "#C94C45", "#2F7F86"];
  let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return (
    <div className="q-logo" style={{ width: size, height: size, background: colors[h % colors.length], fontSize: size > 36 ? 16 : 14 }}>
      {name.trim()[0]?.toUpperCase() ?? "?"}
    </div>
  );
}

export function ButtonLink({ href, children, className = "btn btn-sec" }: { href: string; children: ReactNode; className?: string }) {
  return <Link href={href} className={className}>{children}</Link>;
}

export function FilterChips({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="filters" role="tablist">
      {options.map((o) => (
        <button key={o} role="tab" aria-selected={value === o} className={`filt ${value === o ? "on" : ""}`} onClick={() => onChange(o)}>{o}</button>
      ))}
    </div>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <div role="switch" aria-checked={on} aria-label={label} tabIndex={0} className={`toggle ${on ? "on" : ""}`}
    onClick={() => onChange(!on)} onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); onChange(!on); } }} />;
}

export function SpecRow({ label, value, children }: { label: string; value?: ReactNode; children?: ReactNode }) {
  return <div className="spec-row"><span className="mut">{label}</span><span className="v num">{value ?? children}</span></div>;
}
