# Architecture

Implements the Technical PRD. This page records where the implementation differs and why.

## Deviations from the PRD

| PRD | Built | Reason |
|---|---|---|
| Supabase | **Neon Postgres** | Requested. |
| Supabase Auth | **Better Auth** (self-hosted, Drizzle adapter) | Neon has no bundled auth. Same features: email + password, verification, recovery, persistent sessions. |
| RLS with `auth.uid()` | RLS with transaction-scoped settings `app.current_user_id` / `app.current_business_id`, set by `withTenant()` | `auth.uid()` is Supabase-specific. |
| Supabase Realtime | Persisted `agent_events` + SSE (Phase 7) | No equivalent on Neon. |
| `users` table | Better Auth's `user` table | Better Auth owns that model; `tests/unit/auth-schema.test.ts` guards compatibility. |
| (not listed) | Extra tables: `supplier_payout_destinations`, `approvals`, `agent_task_stages`, `document_counters` | The policy engine needs human-approved recipients; the approvals screens need a record; PRD s8.3 needs per-stage state; request/PO numbers must be race-free. |
| (not listed) | `business_id` on child tables | Lets RLS filter every table directly instead of joining. |

## Financial safety, as built

Layered so no single failure can move money:

1. **Policy engine** (`packages/policies`): pure and deterministic, no AI. `evaluateOrderPolicy`
   before a session is requested; `evaluatePaymentExecution` as the final gate, returning every
   violated restriction.
2. **State machines** (`packages/shared`): a payment can only become `confirmed` from `submitted`
   or `pending`.
3. **Database guards** (migration `0001`): the same payment transitions enforced by a trigger;
   amount, recipient, asset and order are immutable once authorised; a confirmed payment must
   carry a hash and timestamp; only one live payment per purchase order; unique idempotency key.
4. **Order fingerprint**: a hash of everything payable, stored at approval and re-checked before
   execution. Any change voids the approval.
5. **Append-only** `audit_logs` and `agent_events`: triggers plus no UPDATE/DELETE privilege.
6. **Money** is `NUMERIC(20,6)` in the database and BigInt arithmetic in code. Currencies are
   never mixed without an explicit conversion.

## Multi-tenancy

Every request: authenticated session -> active membership (read through RLS) -> role permission
-> queries inside `withTenant()`. A query that forgets its `business_id` filter still cannot
cross tenants. Tested in `tests/integration/database.test.ts`.

## Status

| Phase | State |
|---|---|
| 1 Foundation | Done: monorepo, Next.js, Better Auth, env, migrations |
| 2 Business and procurement data | Done: business onboarding, requests, suppliers, quotations, purchase orders, approvals. |
| 3 Core UI | Done: the prototype is ported to Next.js routes (all PRD s17.1 routes) with loading, empty, error and retry states. Verified in a browser in live and demo mode, light and dark, at desktop and phone width. |
| 4 SERV | Not started. Confirm base URL, model and parameters from the official docs first. The deterministic layer it will sit on top of exists (see below). |
| 5 Supplier provider | Done for the demo provider (`packages/procurement`). Live providers need credentials and docs. |

## Procurement core (`packages/procurement`)

Pure, deterministic and model-free. SERV will only ever choose among what this layer allows.

- **Evidence** (`evidence.ts`): missing evidence is `null` (unknown), never true. Expired evidence is ignored. A failure beats a success.
- **Eligibility** (`eligibility.ts`): hard failures make a quote `ineligible`; unknown identity, contact or payment evidence makes it `review_required`. A missing delivery history is a concern, not a blocker.
- **Comparison** (`comparison.ts`): ranks only eligible quotes. Savings are "estimated" against a stated baseline (highest eligible quote), never realised. A `review_required` quote is never recommended automatically.
- **Purchase order** (`purchase-order.ts`): every figure recomputed from unit prices. A total claimed by the UI or a model is only cross-checked. A supplier whose stated subtotal disagrees with its unit prices is rejected. Currency conversion needs an explicit, fresh rate supplied by the server.
- **Services** (`services/`): sourcing is idempotent; ordering refuses ineligible quotes; approval needs a human-approved payout address and records the order fingerprint.

A payout address is only ever proposed by a provider. A person approves it (`approvals:decide`).
| 6 Kite Passport | Not started. Requires an integration spike against the official CLI. |
| 7 Worker | Not started. |
| 8 Security and tests | Partly: database, policy, money and state-machine tests exist. |
| 9 Deployment | Not started. |

## Frontend

- **Live and demo share one data interface** (`apps/web/lib/queries.ts`). Components never know which mode they are in. Live calls `/api`; demo reads an in-browser store (`lib/demo/store.ts`) with the same shapes.
- **Demo runs the real engine.** The store imports `@procura/procurement/core` (a browser-safe entry point with no database code), so the demo's comparison, eligibility and purchase orders come from the same functions the server uses. Only persistence and the Kite payment are simulated.
- **Honest about what is not connected.** Live mode shows SERV Reasoning and Kite Passport as "not connected": the assistant will not interpret free text, and nothing can be paid. A control that would need them is disabled and says why.
- **No invented numbers.** Dashboard and intelligence figures are derived from real orders and requests. Savings are labelled estimated and use a stated baseline.
- **Sessions:** `app/(app)/layout.tsx` resolves the session and business on the server for every protected screen. Role checks in the UI only hide controls; the API enforces them.
- **Local development without Neon:** `scripts/dev-db.mjs` serves PGlite over a socket and the app drops to the `procura_app` role per transaction, so Row Level Security is enforced locally too.

## Known gaps

- Email provider (verification, invitations, reset links print to the server console in development).
- Team invitations, editing onboarding preferences, billing.
- SERV Reasoning and Kite Passport (Phases 4, 6).
- Background worker and realtime events (Phase 7): sourcing currently runs inline in the request.
- No automated browser tests yet; the screens were verified manually.
