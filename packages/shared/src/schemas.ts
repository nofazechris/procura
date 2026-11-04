import { z } from "zod";
import { EVIDENCE_TYPES, MEMBER_ROLES } from "./constants";

/** A positive-or-zero decimal string such as "2000.00". Amounts are never JS numbers. */
export const decimalString = z
  .string()
  .regex(/^\d+(\.\d{1,6})?$/, "Must be a non-negative decimal with up to 6 decimal places");

/** A decimal string greater than zero, for quantities. */
export const positiveDecimal = decimalString.refine((v) => /[1-9]/.test(v), "Must be greater than zero");

export const currencyCode = z.string().min(2).max(10);

/** Workflow A output (Technical PRD s7.3). Validated before anything is saved. */
export const ProcurementIntentSchema = z.object({
  title: z.string().min(1),
  items: z
    .array(
      z.object({
        name: z.string().min(1),
        quantity: z.number().positive(),
        unit: z.string().min(1),
        specifications: z.record(z.string(), z.unknown()).default({}),
      }),
    )
    .min(1),
  budget: z.object({ amount: decimalString, currency: currencyCode }),
  deliveryLocation: z.string(),
  deliveryDeadline: z.string().nullable(),
  priorities: z.array(z.enum(["price", "reliability", "speed", "quality"])),
  missingInformation: z.array(z.string()),
});
export type ProcurementIntent = z.infer<typeof ProcurementIntentSchema>;

/** Workflow C output. */
export const SupplierEvaluationSchema = z.object({
  supplierId: z.string().uuid(),
  eligibility: z.enum(["eligible", "review_required", "ineligible"]),
  strengths: z.array(z.string()),
  concerns: z.array(z.string()),
  evidenceUsed: z.array(z.string()),
  missingEvidence: z.array(z.string()),
  explanation: z.string(),
});
export type SupplierEvaluation = z.infer<typeof SupplierEvaluationSchema>;

/**
 * A missing value is unknown, never success (Technical PRD s9.4).
 * `null` means "not checked".
 */
export const SupplierEvidenceSummarySchema = z.object({
  identityVerified: z.boolean().nullable(),
  contactVerified: z.boolean().nullable(),
  quotationReceived: z.boolean(),
  paymentDestinationMatched: z.boolean().nullable(),
  historicalPerformanceAvailable: z.boolean(),
  unresolvedConcerns: z.array(z.string()),
});
export type SupplierEvidenceSummary = z.infer<typeof SupplierEvidenceSummarySchema>;

export const evidenceTypeSchema = z.enum(EVIDENCE_TYPES);

/** Business onboarding payload (Screen 03 and Technical PRD s6.1). */
export const CreateBusinessSchema = z.object({
  name: z.string().trim().min(2).max(120),
  industry: z.string().trim().min(1).max(80),
  countryCode: z.string().length(2).transform((v) => v.toUpperCase()),
  defaultCurrency: currencyCode.transform((v) => v.toUpperCase()),
  website: z.string().url().optional().or(z.literal("")),
  address: z.string().max(300).optional(),
  monthlyBudget: decimalString,
  maxSinglePurchase: decimalString,
  approvalRequiredAbove: decimalString.optional(),
  preferences: z
    .object({
      size: z.string().max(20),
      categories: z.array(z.string().max(80)).max(40),
      quality: z.enum(["Budget", "Balanced", "Premium"]),
      frequency: z.string().max(40),
      delivery: z.enum(["Fastest", "Cheapest", "Balanced"]),
      preferredSuppliers: z.string().max(500),
    })
    .partial()
    .optional(),
});
export type CreateBusinessInput = z.infer<typeof CreateBusinessSchema>;

export const UpdateBusinessSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    industry: z.string().trim().min(1).max(80),
    website: z.string().url().or(z.literal("")),
    address: z.string().max(300),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

export const UpdatePolicySchema = z
  .object({
    maxTotalSpend: decimalString,
    maxTransactionAmount: decimalString,
    approvalRequiredAbove: decimalString.nullable(),
    approvalRequired: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

export const CreateProcurementItemSchema = z.object({
  productName: z.string().trim().min(1).max(200),
  description: z.string().max(1000).optional(),
  category: z.string().max(80).optional(),
  quantity: positiveDecimal,
  unit: z.string().trim().min(1).max(40),
  specifications: z.record(z.string(), z.unknown()).default({}),
  preferredBrand: z.string().max(120).optional(),
});

export const CreateProcurementRequestSchema = z.object({
  title: z.string().trim().min(2).max(200),
  description: z.string().max(4000).optional(),
  budgetAmount: decimalString,
  currency: currencyCode.transform((v) => v.toUpperCase()),
  deliveryLocation: z.string().max(300).optional(),
  deliveryDeadline: z.string().datetime().optional(),
  priority: z.enum(["price", "reliability", "speed", "quality"]).default("price"),
  items: z.array(CreateProcurementItemSchema).min(1).max(100),
});
export type CreateProcurementRequestInput = z.infer<typeof CreateProcurementRequestSchema>;

export const memberRoleSchema = z.enum(MEMBER_ROLES);

/** Consistent API envelope (Technical PRD s15). */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string; details?: unknown };
}
