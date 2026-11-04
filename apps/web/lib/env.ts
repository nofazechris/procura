import { z } from "zod";

/** Server-side environment. Validated lazily so `next build` works without secrets present. */
const schema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required (Neon pooled URL for the procura_app role)"),
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  BETTER_AUTH_URL: z.string().url().optional(),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  REQUIRE_EMAIL_VERIFICATION: z.enum(["true", "false"]).default("true"),
  /** Demo only: treat 1 USD as 1 USDC.e. Keep "false" in production; there is no rate feed yet. */
  ALLOW_FIXED_USD_PEG: z.enum(["true", "false"]).default("false"),
  /** The controlled testnet wallet that demo suppliers propose as their payout address. */
  DEMO_RECIPIENT_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/, "Must be a 0x address").optional(),
});

export type ServerEnv = z.infer<typeof schema>;

let cached: ServerEnv | undefined;

export function serverEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment: ${issues}`);
  }
  cached = parsed.data;
  return cached;
}
