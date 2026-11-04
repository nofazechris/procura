import type {
  MemberRole, PaymentStatus, PurchaseOrderStatus, RequestStatus, SupplierEvidenceSummary, SupplierSourceType,
  VerificationStatus,
} from "@procura/shared";
import type { ComparisonView } from "@procura/procurement/core";

/**
 * JSON shapes returned by /api. Dates arrive as ISO strings and money as decimal strings
 * (6 places), exactly as stored. Demo mode produces the same shapes.
 */

export type { ComparisonView };
export type Iso = string;

export interface BusinessSummaryDTO {
  id: string; name: string; slug: string; defaultCurrency: string; role: MemberRole;
}

export interface BusinessDTO {
  id: string; name: string; slug: string; industry: string | null; countryCode: string; defaultCurrency: string;
  website: string | null; address: string | null; preferences: Record<string, unknown>;
}

export interface MemberDTO {
  id: string; userId: string; name: string; email: string; role: MemberRole; status: string;
}

export interface RequestDTO {
  id: string; businessId: string; requestNumber: string; title: string; description: string | null;
  status: RequestStatus; budgetAmount: string; currency: string; deliveryLocation: string | null;
  deliveryDeadline: Iso | null; priority: string; requestedBy: string | null; requestedByName?: string | null;
  createdAt: Iso; updatedAt: Iso;
}

export interface RequestItemDTO {
  id: string; requestId: string; productName: string; description: string | null; category: string | null;
  quantity: string; unit: string; specifications: Record<string, unknown>; preferredBrand: string | null;
}

export interface RequestDetailDTO extends RequestDTO { items: RequestItemDTO[] }

export interface SupplierDTO {
  id: string; name: string; legalName: string | null; description: string | null; countryCode: string | null;
  city: string | null; email: string | null; phone: string | null; website: string | null; categories: string[];
  verificationStatus: VerificationStatus; sourceType: SupplierSourceType; createdAt: Iso;
  evidenceSummary: SupplierEvidenceSummary;
}

export interface EvidenceDTO {
  id: string; evidenceType: string; sourceName: string; verificationStatus: VerificationStatus; collectedAt: Iso;
  expiresAt: Iso | null;
  /** What the check found, in the check's own words: { summary, ... }. */
  evidenceData?: Record<string, unknown>;
}

export interface PayoutDestinationDTO {
  id: string; supplierId: string; address: string; network: string; asset: string;
  status: "pending" | "approved" | "revoked"; approvedAt: Iso | null;
}

export interface QuotationDTO {
  id: string; requestId: string; supplierId: string; supplierQuoteReference: string | null; subtotal: string;
  deliveryCost: string; additionalCosts: string; totalCost: string; currency: string;
  estimatedDeliveryDays: number | null; quoteStatus: string; createdAt: Iso; validUntil: Iso | null;
}

export interface SupplierDetailDTO {
  supplier: Omit<SupplierDTO, "evidenceSummary">;
  evidence: EvidenceDTO[];
  payoutDestinations: PayoutDestinationDTO[];
  quotations: QuotationDTO[];
  evidenceSummary: SupplierEvidenceSummary;
}

export interface OrderDTO {
  id: string; requestId: string; supplierId: string; quotationId: string | null; orderNumber: string;
  subtotal: string; deliveryCost: string; totalAmount: string; currency: string; paymentAsset: string;
  paymentAmount: string; status: PurchaseOrderStatus; approvedFingerprint: string | null; approvedAt: Iso | null;
  createdAt: Iso; supplierName: string; supplierSource: SupplierSourceType; requestNumber: string; requestTitle: string;
}

export interface OrderItemDTO {
  id: string; description: string; quantity: string; unitPrice: string; totalPrice: string; currency: string;
}

export interface ApprovalRowDTO {
  id: string; status: "pending" | "approved" | "rejected" | "expired" | "changes_requested";
  amount: string; currency: string; reason: string | null; expiresAt: Iso | null; decidedAt: Iso | null; createdAt: Iso;
}

export interface OrderDetailDTO {
  order: Omit<OrderDTO, "supplierName" | "supplierSource" | "requestNumber" | "requestTitle"> & {
    paymentTerms: string | null; deliveryTerms: string | null; approvedBy: string | null;
  };
  items: OrderItemDTO[];
  approvals: ApprovalRowDTO[];
  supplier: { id: string; name: string; sourceType: SupplierSourceType; city: string | null; countryCode: string | null } | null;
  request: { id: string; requestNumber: string; title: string } | null;
  business: { name: string; address: string | null; countryCode: string } | null;
  destination: PayoutDestinationDTO | null;
}

export interface ApprovalDTO extends ApprovalRowDTO {
  orderId: string; orderNumber: string; orderStatus: PurchaseOrderStatus; paymentAsset: string; paymentAmount: string;
  requestId: string; requestNumber: string; requestTitle: string;
  supplierId: string; supplierName: string; supplierSource: SupplierSourceType;
  destination: PayoutDestinationDTO | null;
}

export interface PaymentDTO {
  id: string; status: PaymentStatus; amount: string; asset: string; network: string; recipientAddress: string;
  transactionHash: string | null; failureReason: string | null; confirmedAt: Iso | null; createdAt: Iso;
  orderId: string; orderNumber: string; supplierId: string; supplierName: string;
}

export interface ActivityDTO {
  id: string; actorType: "user" | "agent" | "system" | "worker"; actorId: string | null; actorName: string | null;
  action: string; resourceType: string; resourceId: string | null;
  newState: Record<string, unknown> | null; metadata: Record<string, unknown>; createdAt: Iso;
}

export interface PolicyDTO {
  id: string; currency: string; maxTotalSpend: string; maxTransactionAmount: string; approvalRequired: boolean;
  approvalRequiredAbove: string | null;
}

export interface SourcingSummaryDTO {
  suppliersFound: number; quotationsCreated: number; quotationsSkipped: number; requestStatus: RequestStatus;
}

export interface WalletDTO {
  id: string; address: string; chainId: number; label: string | null; status: "active" | "revoked";
  linkedAt: string; revokedAt: string | null;
}

export interface WalletBalancesDTO {
  status: "ok" | "unavailable"; chainId: number;
  native: { symbol: string; amount: string } | null;
  token: { symbol: string; amount: string; address: string } | null;
  tokenNotConfigured: boolean;
}

export interface PassportSessionDTO {
  id: string; taskSummary: string; maxPerTx: string; maxTotal: string; asset: string;
  status: "requested" | "awaiting_user_approval" | "active" | "exhausted" | "expired" | "revoked" | "failed";
  createdAt: string; expiresAt: string | null; approvalUrl: string | null;
}

export interface PassportDTO {
  enabled: boolean;
  canManage: boolean;
  agent: { type: string; id: string; registeredAt: string } | null;
  sessions: PassportSessionDTO[];
  live: {
    loggedIn: boolean; backendEnv: string | null; backendReachable: boolean; ownerHint: string | null;
    allowance: "none" | "active" | "unknown"; wallet: { address: string | null; usdcTotal: string | null };
  } | null;
  liveError: { code: string; message: string } | null;
  /** Present only while Passport is not enabled for this business: the value to put in PASSPORT_BUSINESS_ID. */
  businessId: string | null;
}


/* Supplier verification: paid checks bought through an approved Passport session. */
export interface VerifyPlanDTO {
  enabled: boolean;
  checks: { id: "sanctions" | "registry" | "email"; label: string; proves: string; limit: string; price: string; ready: boolean; missing: string | null }[];
  estimate: string;
  currency: "USD";
  sessions: { id: string; taskSummary: string; maxPerTx: string; maxTotal: string; expiresAt: string | null }[];
}

export interface VerifyRunDTO {
  reports: {
    check: "sanctions" | "registry" | "email"; label: string; state: "done" | "error" | "skipped";
    outcome?: { status: VerificationStatus; summary: string };
    charged?: string | null; error?: { kind: string; message: string };
  }[];
  stopped: boolean;
}
