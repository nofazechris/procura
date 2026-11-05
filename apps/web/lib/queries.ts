"use client";

import { useMutation, useQueries, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { fromUnits, ServiceError, toUnits } from "@procura/shared";
import { api, ApiClientError } from "./api-client";
import { useApp } from "./app-context";
import {
  demoApproveOrder, demoApprovePayout, demoComparison, demoCreateOrder, demoCreateRequest, demoExecutePayment,
  demoOrderDetail, demoRejectOrder, demoSourcing, demoSupplierDetail, demoSuppliers, getDemo,
} from "./demo/store";
import type {
  ActivityDTO, ApprovalDTO, BusinessDTO, ComparisonView, MemberDTO, OrderDetailDTO, OrderDTO, PaymentDTO, PolicyDTO,
  RequestDetailDTO, RequestDTO, SourcingSummaryDTO, SupplierDetailDTO, SupplierDTO, WalletBalancesDTO, WalletDTO, PassportDTO, PassportSessionDTO, VerifyPlanDTO, VerifyRunDTO, CallScriptDTO,
} from "./dto";

/** Demo throws ServiceError; live throws ApiClientError. Present both the same way. */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiClientError || e instanceof ServiceError || e instanceof Error) return e.message;
  return "Something went wrong. Please try again.";
}
export function errorCode(e: unknown): string | undefined {
  if (e instanceof ApiClientError || e instanceof ServiceError) return e.code;
  return undefined;
}
export function errorDetails(e: unknown): unknown {
  if (e instanceof ApiClientError || e instanceof ServiceError) return e.details;
  return undefined;
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** One data interface for both modes: the live API, or the in-browser demo store with the same shapes. */
function useModeQuery<T>(key: unknown[], live: () => Promise<T>, demo: () => Promise<T>, enabled = true): UseQueryResult<T> {
  const { mode, business } = useApp();
  return useQuery<T>({
    queryKey: [mode, business.id, ...key],
    queryFn: mode === "demo" ? async () => clone(await demo()) : live,
    enabled,
    staleTime: 3_000,
  });
}

export const useRequests = () => useModeQuery<RequestDTO[]>(["requests"], () => api("/procurement"), async () => (await getDemo()).requests);

export const useRequest = (id: string) =>
  useModeQuery<RequestDetailDTO>(["request", id], () => api(`/procurement/${id}`), async () => {
    const r = (await getDemo()).requests.find((x) => x.id === id);
    if (!r) throw new ServiceError("NOT_FOUND", "Procurement request not found.", 404);
    return r;
  });

export const useComparison = (id: string) =>
  useModeQuery<ComparisonView>(["comparison", id], () => api(`/procurement/${id}/comparison`), () => demoComparison(id));

export const useSuppliers = () => useModeQuery<SupplierDTO[]>(["suppliers"], () => api("/suppliers"), demoSuppliers);

export const useSupplier = (id: string) =>
  useModeQuery<SupplierDetailDTO>(["supplier", id], () => api(`/suppliers/${id}`), () => demoSupplierDetail(id));

export const useOrders = () => useModeQuery<OrderDTO[]>(["orders"], () => api("/orders"), async () => (await getDemo()).orders);

export const useOrder = (id: string) =>
  useModeQuery<OrderDetailDTO>(["order", id], () => api(`/orders/${id}`), () => demoOrderDetail(id));

export const useApprovals = () => useModeQuery<ApprovalDTO[]>(["approvals"], () => api("/approvals"), async () => (await getDemo()).approvals);

export const usePayments = () => useModeQuery<PaymentDTO[]>(["payments"], () => api("/payments"), async () => (await getDemo()).payments);

export const useActivity = () => useModeQuery<ActivityDTO[]>(["activity"], () => api("/activity"), async () => (await getDemo()).activity);

export const usePolicy = () => useModeQuery<PolicyDTO>(["policy"], () => api("/policy"), async () => (await getDemo()).policy);

export function useBusinessDetail() {
  const { business } = useApp();
  return useModeQuery<BusinessDTO>(["business"], () => api(`/business/${business.id}`), async () => (await getDemo()).business);
}

export function useMembers() {
  const { business } = useApp();
  return useModeQuery<MemberDTO[]>(["members"], () => api(`/business/${business.id}/members`), async () => (await getDemo()).members);
}

/* ------------------------------------------------------------------ */
/* Mutations. Every one refreshes all queries, so every screen agrees. */
/* ------------------------------------------------------------------ */

export interface NewRequestInput {
  title: string;
  budgetAmount: string;
  currency: string;
  deliveryLocation?: string;
  deliveryDeadline?: string;
  priority: "price" | "reliability" | "speed" | "quality";
  items: { productName: string; quantity: string; unit: string; category?: string; description?: string }[];
}

function useRefreshingMutation<I, O>(live: (i: I) => Promise<O>, demo: (i: I) => Promise<O>) {
  const { mode } = useApp();
  const qc = useQueryClient();
  return useMutation<O, unknown, I>({
    mutationFn: (input) => (mode === "demo" ? demo(input) : live(input)),
    onSuccess: () => qc.invalidateQueries(),
  });
}

export const useCreateRequest = () =>
  useRefreshingMutation<NewRequestInput, RequestDetailDTO>(
    (i) => api("/procurement", { method: "POST", body: i }),
    (i) => demoCreateRequest(i),
  );

/** Where to look for products: the fictional demo suppliers, or Amazon through Kite Passport. */
export type SourceChoice = "demo" | "amazon";

export const useStartSourcing = () =>
  useRefreshingMutation<string | { id: string; source: SourceChoice }, SourcingSummaryDTO>(
    (arg) => {
      const { id, source } = typeof arg === "string" ? { id: arg, source: "demo" as SourceChoice } : arg;
      return api(`/procurement/${id}/sourcing`, { method: "POST", body: { provider: source } });
    },
    (arg) => demoSourcing(typeof arg === "string" ? arg : arg.id),
  );

export const useCreateOrder = () =>
  useRefreshingMutation<{ requestId: string; quotationId: string; acknowledgeReview?: boolean }, { id: string; orderNumber: string }>(
    async (i) => {
      const r = await api<{ order: { id: string; orderNumber: string } }>("/orders", { method: "POST", body: i });
      return r.order;
    },
    async (i) => demoCreateOrder(i.requestId, i.quotationId, !!i.acknowledgeReview),
  );

export const useApproveOrder = () =>
  useRefreshingMutation<string, unknown>(
    (id) => api(`/orders/${id}/approve`, { method: "POST" }),
    (id) => demoApproveOrder(id),
  );

export const useRejectOrder = () =>
  useRefreshingMutation<{ id: string; reason?: string }, unknown>(
    (i) => api(`/orders/${i.id}/reject`, { method: "POST", body: { reason: i.reason } }),
    async (i) => demoRejectOrder(i.id),
  );

/** Practice checkout: runs the real payment gate and records a payment on the simulation network. Nothing is charged. */
export const useCheckout = () =>
  useRefreshingMutation<string, { reference: string; simulated: true }>(
    (id) => api(`/orders/${id}/checkout`, { method: "POST" }),
    async () => { throw new ServiceError("NOT_AVAILABLE", "In the demo, open Approvals to simulate the payment.", 400); },
  );

export const useApprovePayout = () =>
  useRefreshingMutation<{ supplierId: string; destinationId: string }, unknown>(
    (i) => api(`/suppliers/${i.supplierId}/payout-destinations/${i.destinationId}/approve`, { method: "POST" }),
    (i) => demoApprovePayout(i.destinationId),
  );

/** Demo only. Live payments need Kite Passport (not connected), so there is intentionally no live equivalent. */
export const useDemoPayment = () =>
  useRefreshingMutation<string, PaymentDTO>(
    async () => { throw new ServiceError("PASSPORT_NOT_CONNECTED", "Payments need Kite Passport, which is not connected yet.", 409); },
    (orderId) => demoExecutePayment(orderId),
  );

export const useUpdatePolicy = () =>
  useRefreshingMutation<Partial<{ maxTotalSpend: string; maxTransactionAmount: string; approvalRequiredAbove: string | null; approvalRequired: boolean }>, PolicyDTO>(
    (i) => api("/policy", { method: "PATCH", body: i }),
    async (i) => {
      const s = await getDemo();
      Object.assign(s.policy, {
        ...(i.maxTotalSpend ? { maxTotalSpend: i.maxTotalSpend } : {}),
        ...(i.maxTransactionAmount ? { maxTransactionAmount: i.maxTransactionAmount } : {}),
        ...(i.approvalRequiredAbove !== undefined ? { approvalRequiredAbove: i.approvalRequiredAbove } : {}),
        ...(i.approvalRequired !== undefined ? { approvalRequired: i.approvalRequired } : {}),
      });
      return s.policy;
    },
  );

export const useUpdateBusiness = () => {
  const { business } = useApp();
  return useRefreshingMutation<Partial<{ name: string; industry: string; website: string; address: string; preferences: { quality?: string; categories?: string[] } }>, BusinessDTO>(
    (i) => api(`/business/${business.id}`, { method: "PATCH", body: i }),
    async (i) => {
      const s = await getDemo();
      Object.assign(s.business, i);
      return s.business;
    },
  );
};

/**
 * Estimated savings across the requests currently being compared. Each request's comparison is
 * fetched through the same cache as the comparison screen, so this adds no duplicate work.
 */
export function useSavingsEstimate(requestIds: string[]) {
  const { mode, business } = useApp();
  const results = useQueries({
    queries: requestIds.slice(0, 6).map((id) => ({
      queryKey: [mode, business.id, "comparison", id],
      queryFn: mode === "demo" ? async () => clone(await demoComparison(id)) : () => api<ComparisonView>(`/procurement/${id}/comparison`),
      staleTime: 3_000,
    })),
  });
  const loading = results.some((r) => r.isPending);
  let total = 0n;
  let currency = "USD";
  for (const r of results) {
    const s = r.data?.comparison.estimatedSavings;
    if (s) { total += toUnits(s.amount); currency = s.currency; }
  }
  return { loading, amount: fromUnits(total), currency, count: results.filter((r) => r.data?.comparison.estimatedSavings).length };
}

export const useCancelRequest = () =>
  useRefreshingMutation<string, unknown>(
    (id) => api(`/procurement/${id}/cancel`, { method: "POST" }),
    async (id) => {
      const s = await getDemo();
      const r = s.requests.find((x) => x.id === id);
      if (!r) throw new ServiceError("NOT_FOUND", "Procurement request not found.", 404);
      const open = s.orders.find((o) => o.requestId === id && ["pending_approval", "approved", "paid", "processing"].includes(o.status));
      if (open) throw new ServiceError("OPEN_ORDER", `${open.orderNumber} is still ${open.status.replace("_", " ")}. Reject or resolve the order before cancelling.`, 409);
      r.status = "cancelled";
      return { id, status: "cancelled" };
    },
  );

/* Wallets exist only for real businesses: there is nothing to link in the in-browser demo. */
export const useWallets = () => useModeQuery<WalletDTO[]>(["wallets"], () => api("/wallets"), async () => []);

export const useWalletBalance = (id: string) =>
  useModeQuery<WalletBalancesDTO>(["wallet-balance", id], () => api(`/wallets/${id}/balance`), async () => {
    throw new ServiceError("NOT_AVAILABLE", "Balances are not available in demo mode.", 400);
  });

export const useRevokeWallet = () =>
  useRefreshingMutation<string, { id: string }>((id) => api(`/wallets/${id}`, { method: "DELETE" }), async () => {
    throw new ServiceError("NOT_AVAILABLE", "Wallets are not available in demo mode.", 400);
  });

/* The agent (SERV Reasoning). Live only: the in-browser demo has no model behind it. */
export interface AgentStatusDTO { configured: boolean; model: string | null }
export const useAgentStatus = () =>
  useModeQuery<AgentStatusDTO>(["agent-status"], () => api("/agent/status"), async () => ({ configured: false, model: null }));

export interface InterpretedDTO {
  draft: {
    title: string; items: { productName: string; quantity: string; unit: string; category: string }[];
    budgetAmount: string; currency: string; deliveryLocation: string; deliveryDeadline: string;
    priority: "price" | "reliability" | "speed" | "quality";
  };
  missing: string[];
  notes: string[];
  model: string;
}
export const useInterpret = () =>
  useMutation<InterpretedDTO, unknown, string>({ mutationFn: (text) => api("/agent/interpret", { method: "POST", body: { text } }) });

export interface ExplanationDTO {
  preferredQuoteId: string | null; preferredSupplier: string | null; engineQuoteId: string | null; agreesWithEngine: boolean;
  summary: string; tradeoffs: string[]; questionsForYou: string[]; model: string;
}
export const useExplain = (requestId: string) =>
  useMutation<ExplanationDTO, unknown, void>({ mutationFn: () => api(`/procurement/${requestId}/explain`, { method: "POST" }) });

/* Kite Passport: agent identity and spending sessions. Live only; the demo has nothing to connect to. */
export const usePassport = (live = false) =>
  useModeQuery<PassportDTO>(["passport", live], () => api(live ? "/passport?live=1" : "/passport"), async () => ({
    enabled: false, canManage: false, agent: null, sessions: [], live: null, liveError: null, businessId: null,
  }));

export const useRegisterAgent = () =>
  useRefreshingMutation<void, { id: string }>(() => api("/passport/agent", { method: "POST" }), async () => {
    throw new ServiceError("NOT_AVAILABLE", "Passport is not available in demo mode.", 400);
  });

export interface RequestSessionInput { taskSummary: string; maxPerTx: string; maxTotal: string; ttlMinutes: number }
export const useRequestSession = () =>
  useRefreshingMutation<RequestSessionInput, PassportSessionDTO>((i) => api("/passport/sessions", { method: "POST", body: i }), async () => {
    throw new ServiceError("NOT_AVAILABLE", "Passport is not available in demo mode.", 400);
  });

export const useRefreshSession = () =>
  useRefreshingMutation<string, PassportSessionDTO>((id) => api(`/passport/sessions/${id}/refresh`, { method: "POST" }), async () => {
    throw new ServiceError("NOT_AVAILABLE", "Passport is not available in demo mode.", 400);
  });

/* Suppliers added by hand, and paid verification checks. Live only: the demo has no real businesses to check. */
export interface NewSupplierInput {
  name: string; legalName?: string; website?: string; countryCode?: string; city?: string; email?: string; phone?: string; categories?: string[];
}
const NOT_IN_DEMO = async (): Promise<never> => { throw new ServiceError("NOT_AVAILABLE", "This needs a real business. The demo is read only.", 400); };

export const useAddSupplier = () =>
  useRefreshingMutation<NewSupplierInput, SupplierDTO>((i) => api("/suppliers", { method: "POST", body: i }), NOT_IN_DEMO);

export const useVerifyPlan = (supplierId: string) =>
  useModeQuery<VerifyPlanDTO>(["verify-plan", supplierId], () => api(`/suppliers/${supplierId}/verify`), async () => ({
    enabled: false, checks: [], estimate: "0", currency: "USD" as const, sessions: [],
  }));

export interface VerifyInput { checks: string[]; sessionId: string; maxCost: string }
export const useVerifySupplier = (supplierId: string) =>
  useRefreshingMutation<VerifyInput, VerifyRunDTO>((i) => api(`/suppliers/${supplierId}/verify`, { method: "POST", body: i }), NOT_IN_DEMO);

/** The agent drafts what it would say on a call. A rehearsal only: nobody is called. */
export const useCallScript = (supplierId: string) =>
  useMutation<CallScriptDTO, unknown, { requestId?: string }>({
    mutationFn: (i) => api(`/suppliers/${supplierId}/call-script`, { method: "POST", body: i }),
  });
