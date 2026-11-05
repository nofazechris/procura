import { z } from "zod";

/** Server-side environment. Validated lazily so `next build` works without secrets present. */
/** An empty value in .env (KEY=) means "not set", so defaults and optionals still apply. */
const blank = <T extends z.ZodType>(t: T) => z.preprocess((v) => (v === "" ? undefined : v), t);

const schema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required (Neon pooled URL for the procura_app role)"),
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  BETTER_AUTH_URL: z.string().url().optional(),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  REQUIRE_EMAIL_VERIFICATION: z.enum(["true", "false"]).default("true"),
  /** Demo only: treat 1 USD as 1 USDC.e. Keep "false" in production; there is no rate feed yet. */
  ALLOW_FIXED_USD_PEG: z.enum(["true", "false"]).default("false"),
  /** The controlled testnet wallet that demo sellers propose as their payout address. */
  /** ERC-20 the escrow and payments will use on Kite. Not published in the Kite docs yet, so it is explicit config; balances show the native token only until it is set. */
  PAYMENT_TOKEN_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/, "Must be a 0x address").optional().or(z.literal("").transform(() => undefined)),
  /** SERV Reasoning (https://docs.openserv.ai/serv-reasoning/api). Without a key the agent features report "not connected". */
  SERV_API_KEY: blank(z.string().min(1).optional()),
  SERV_BASE_URL: blank(z.string().url().default("https://inference-api.openserv.ai")),
  SERV_MODEL: blank(z.string().min(1).default("gpt-5.4-mini")),
  /**
   * Kite Passport has no public HTTP API, only the `kpass` CLI, which keeps one login per working folder.
   * KPASS_BIN is the executable, PASSPORT_HOME the folder that holds its .kite-passport login, and
   * PASSPORT_BUSINESS_ID the single business allowed to use that login (one login must not serve several tenants).
   */
  KPASS_BIN: blank(z.string().min(1).default("kpass")),
  PASSPORT_HOME: blank(z.string().min(1).optional()),
  PASSPORT_BUSINESS_ID: blank(z.string().uuid().optional()),
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
