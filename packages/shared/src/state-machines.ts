import type {
  PaymentStatus, PurchaseOrderStatus, RequestStatus, SpendingSessionStatus,
} from "./constants";

type Transitions<S extends string> = Record<S, readonly S[]>;

const REQUEST: Transitions<RequestStatus> = {
  draft: ["submitted", "cancelled"],
  submitted: ["analysing", "failed", "cancelled"],
  analysing: ["sourcing", "failed", "cancelled"],
  sourcing: ["comparing", "failed", "cancelled"],
  comparing: ["awaiting_approval", "sourcing", "failed", "cancelled"],
  awaiting_approval: ["approved", "comparing", "cancelled"],
  approved: ["processing", "cancelled"],
  processing: ["completed", "failed"],
  completed: [],
  failed: ["submitted"],
  cancelled: [],
};

const PURCHASE_ORDER: Transitions<PurchaseOrderStatus> = {
  draft: ["pending_approval", "cancelled"],
  pending_approval: ["approved", "cancelled"],
  approved: ["awaiting_payment", "cancelled"],
  awaiting_payment: ["payment_pending", "cancelled", "failed"],
  payment_pending: ["paid", "awaiting_payment", "failed"],
  paid: ["processing", "disputed"],
  processing: ["fulfilled", "disputed"],
  fulfilled: ["disputed"],
  disputed: ["fulfilled", "cancelled"],
  cancelled: [],
  failed: ["awaiting_payment", "cancelled"],
};

/**
 * `confirmed` is reachable only from `submitted` or `pending`, i.e. after the provider or chain
 * has been asked. A payment can never jump from `prepared` or `authorised` straight to confirmed.
 */
const PAYMENT: Transitions<PaymentStatus> = {
  prepared: ["awaiting_authorisation", "cancelled"],
  awaiting_authorisation: ["authorised", "cancelled", "failed"],
  authorised: ["submitted", "cancelled", "failed"],
  submitted: ["pending", "confirmed", "failed"],
  pending: ["pending", "confirmed", "failed"],
  confirmed: [],
  failed: [],
  cancelled: [],
};

const SESSION: Transitions<SpendingSessionStatus> = {
  requested: ["awaiting_user_approval", "failed", "revoked"],
  awaiting_user_approval: ["active", "expired", "revoked", "failed"],
  active: ["exhausted", "expired", "revoked"],
  exhausted: [],
  expired: [],
  revoked: [],
  failed: [],
};

function can<S extends string>(table: Transitions<S>, from: S, to: S): boolean {
  return table[from].includes(to);
}

export class InvalidTransitionError extends Error {
  constructor(kind: string, from: string, to: string) {
    super(`Invalid ${kind} transition: ${from} -> ${to}`);
    this.name = "InvalidTransitionError";
  }
}

function assertTransition<S extends string>(kind: string, table: Transitions<S>, from: S, to: S): void {
  if (!can(table, from, to)) throw new InvalidTransitionError(kind, from, to);
}

export const canTransitionRequest = (f: RequestStatus, t: RequestStatus) => can(REQUEST, f, t);
export const canTransitionPurchaseOrder = (f: PurchaseOrderStatus, t: PurchaseOrderStatus) => can(PURCHASE_ORDER, f, t);
export const canTransitionPayment = (f: PaymentStatus, t: PaymentStatus) => can(PAYMENT, f, t);
export const canTransitionSession = (f: SpendingSessionStatus, t: SpendingSessionStatus) => can(SESSION, f, t);

export const assertRequestTransition = (f: RequestStatus, t: RequestStatus) => assertTransition("request", REQUEST, f, t);
export const assertPurchaseOrderTransition = (f: PurchaseOrderStatus, t: PurchaseOrderStatus) => assertTransition("purchase order", PURCHASE_ORDER, f, t);
export const assertPaymentTransition = (f: PaymentStatus, t: PaymentStatus) => assertTransition("payment", PAYMENT, f, t);
export const assertSessionTransition = (f: SpendingSessionStatus, t: SpendingSessionStatus) => assertTransition("spending session", SESSION, f, t);
