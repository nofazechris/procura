import type { IconName } from "@/components/icon";
import { amount } from "./format";
import type { ActivityDTO } from "./dto";

export type ActivityCategory = "Procurement" | "Supplier" | "Payment" | "Approval" | "Agent" | "Security";

export interface ActivityView {
  title: string;
  sub: string;
  icon: IconName;
  category: ActivityCategory;
  /** True for confirmed, money-related or approval successes, to render in the success tone. */
  ok: boolean;
  href: string;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** Translate a stored audit event into what a person should read. Unknown actions fall back gracefully. */
export function describeActivity(a: ActivityDTO): ActivityView {
  const s = a.newState ?? {};
  const md = a.metadata ?? {};
  const orderNumber = str(s["orderNumber"]);
  const requestNumber = str(s["requestNumber"]);
  const resourceHref = (kind: ActivityDTO["resourceType"]): string => {
    if (!a.resourceId) return "/activity";
    switch (kind) {
      case "procurement_request": return `/procurement/${a.resourceId}`;
      case "purchase_order": return `/orders/${a.resourceId}`;
      case "payment": return `/payments/${a.resourceId}`;
      case "business": return "/settings/business";
      case "spending_policy": return "/settings/agent-permissions";
      default: return "/approvals";
    }
  };
  const href = resourceHref(a.resourceType);

  switch (a.action) {
    case "business.created":
      return { title: "Business created", sub: str(s["name"]) || "Onboarding completed", icon: "building", category: "Security", ok: true, href };
    case "business.updated":
      return { title: "Business profile updated", sub: str(s["name"]), icon: "cog", category: "Security", ok: false, href };
    case "policy.updated":
      return { title: "Spending limits changed", sub: `Monthly ${amount(str(s["maxTotalSpend"]), 0)} · per purchase ${amount(str(s["maxTransactionAmount"]), 0)}`, icon: "sliders", category: "Security", ok: false, href };
    case "procurement.created":
      return { title: "Procurement request created", sub: [requestNumber, s["itemCount"] ? `${s["itemCount"]} items` : ""].filter(Boolean).join(" · "), icon: "pkg", category: "Procurement", ok: false, href };
    case "procurement.sourced":
      return {
        title: "Suppliers discovered and quotes collected",
        sub: md["suppliersFound"] !== undefined ? `${md["suppliersFound"]} suppliers · ${md["quotationsCreated"]} new quotes` : "Request moved to comparing",
        icon: "search", category: "Agent", ok: false, href,
      };
    case "order.created":
      return { title: "Purchase order created", sub: orderNumber, icon: "doc", category: "Procurement", ok: false, href };
    case "order.approved":
      return { title: "Purchase order approved", sub: orderNumber, icon: "shield", category: "Approval", ok: true, href };
    case "order.rejected":
      return { title: "Purchase order rejected", sub: orderNumber, icon: "x", category: "Approval", ok: false, href };
    case "supplier.payout_destination.approved":
      return { title: "Supplier payment address approved", sub: str(s["address"]), icon: "wallet", category: "Approval", ok: true, href };
    case "payment.confirmed":
      return { title: "Payment confirmed", sub: [orderNumber, s["amount"] ? `${amount(str(s["amount"]))}` : ""].filter(Boolean).join(" · "), icon: "check", category: "Payment", ok: true, href };
    default:
      return { title: a.action.replace(/[._]/g, " ").replace(/^\w/, (c) => c.toUpperCase()), sub: a.resourceType.replace(/_/g, " "), icon: "clock", category: a.actorType === "agent" ? "Agent" : "Security", ok: false, href };
  }
}
