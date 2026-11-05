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
    /** How the buyer leans when options are close, and what the person shops for. Merged into what is stored. */
    preferences: z.object({
      quality: z.enum(["Budget", "Balanced", "Premium"]),
      categories: z.array(z.string().trim().min(1).max(80)).max(40),
    }).partial(),
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

/** Step 1 of linking a wallet: ask for a challenge to sign. */
export const WalletChallengeRequestSchema = z.object({
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/, "Must be a 0x address"),
  chainId: z.number().int().positive(),
});

/** Step 2: return the signed challenge. The server re-verifies everything; nothing here is trusted. */
export const LinkWalletSchema = z.object({
  message: z.string().min(1).max(2000),
  token: z.string().regex(/^[0-9a-f]{64}$/),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/).max(400),
  label: z.string().trim().max(60).optional(),
});

/**
 * What the model is asked to return when it reads a plain-language purchase request. Shaped for
 * strict structured output (every key required, unknowns are null). It is a DRAFT: the server
 * re-validates every field and a person reviews it before anything is created.
 */
export const AgentIntentOutputSchema = z.object({
  title: z.string(),
  items: z.array(z.object({
    name: z.string(),
    /** Decimal string such as "50" or "2.5". */
    quantity: z.string(),
    unit: z.string(),
    category: z.string().nullable(),
  })),
  budgetAmount: z.string().nullable(),
  currency: z.string().nullable(),
  deliveryLocation: z.string().nullable(),
  /** ISO date, YYYY-MM-DD. */
  deliveryDeadline: z.string().nullable(),
  priority: z.enum(["price", "reliability", "speed", "quality"]).nullable(),
  /** Anything needed to buy safely that the text did not say. */
  missingInformation: z.array(z.string()),
});
export type AgentIntentOutput = z.infer<typeof AgentIntentOutputSchema>;

export const InterpretRequestSchema = z.object({
  text: z.string().trim().min(3, "Describe what you need to buy.").max(1500, "Keep it under 1,500 characters."),
});

/** The model's reasoning about a comparison it was handed. It may only cite quotes it was shown. */
export const AgentExplanationOutputSchema = z.object({
  /** Must be one of the eligible, ranked quotes it was given, or null when none is clearly better. */
  preferredQuoteId: z.string().nullable(),
  summary: z.string(),
  tradeoffs: z.array(z.string()),
  /** Things a person should confirm before approving, such as unverified evidence. */
  questionsForYou: z.array(z.string()),
});
export type AgentExplanationOutput = z.infer<typeof AgentExplanationOutputSchema>;

/** A phone call the agent would make to a seller, drafted for a person to read. Nothing is dialled. */
export const CallScriptOutputSchema = z.object({
  opening: z.string(),
  questions: z.array(z.string()),
  mustConfirm: z.array(z.string()),
  closing: z.string(),
});
export type CallScriptOutput = z.infer<typeof CallScriptOutputSchema>;

/** Asking Kite Passport for a spending session. The server checks these against the business policy. */
export const RequestPassportSessionSchema = z.object({
  taskSummary: z.string().trim().min(3, "Describe what the agent may do.").max(300),
  maxPerTx: decimalString,
  maxTotal: decimalString,
  ttlMinutes: z.number().int().min(5).max(1440),
});

/** Adding a supplier by hand. Everything past the name is optional and stays "supplier provided" until it is verified. */
export const CreateSupplierSchema = z.object({
  name: z.string().trim().min(2, "Give the supplier a name.").max(120),
  legalName: z.string().trim().max(160).optional(),
  website: z.string().trim().url("Enter a full web address, such as https://example.com").max(300).optional(),
  countryCode: z.string().trim().length(2, "Use a two-letter country code, such as NG or US.").transform((v) => v.toUpperCase()).optional(),
  city: z.string().trim().max(100).optional(),
  email: z.string().trim().email("Enter a valid email address.").max(200).optional(),
  phone: z.string().trim().max(40).optional(),
  categories: z.array(z.string().trim().min(1).max(40)).max(8).default([]),
});
export type CreateSupplierInput = z.infer<typeof CreateSupplierSchema>;

/** Running paid verification checks on a supplier. maxCost is the price the person saw, so a price change is never a surprise. */
export const VerifySupplierSchema = z.object({
  checks: z.array(z.enum(["sanctions", "registry", "email"])).min(1).max(3),
  sessionId: z.string().uuid(),
  maxCost: decimalString,
});
export type VerifySupplierInput = z.infer<typeof VerifySupplierSchema>;
