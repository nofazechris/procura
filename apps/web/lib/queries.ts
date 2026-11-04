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
  RequestDetailDTO, RequestDTO, SourcingSummaryDTO, SupplierDetailDTO, SupplierDTO,
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

export const useStartSourcing = () =>
  useRefreshingMutation<string, SourcingSummaryDTO>(
    (id) => api(`/procurement/${id}/sourcing`, { method: "POST", body: { provider: "demo" } }),
    (id) => demoSourcing(id),
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
  return useRefreshingMutation<Partial<{ name: string; industry: string; website: string; address: string }>, BusinessDTO>(
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
