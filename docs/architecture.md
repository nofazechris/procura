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
| 4 SERV | Done for two workflows: reading a plain-language request into a draft the person reviews, and explaining a comparison. Strict JSON-schema output, server-side re-validation, the model can only cite engine-approved quotes, per-user rate limit, audit entries. Supplier evaluation by the model (Workflow C) is not built; the engine does it deterministically. |
| 5 Supplier provider | Demo provider, plus a live Amazon provider through Kite Passport (`apps/web/lib/server/shop-provider.ts`): free search, three comparable baskets, each line linked to the real listing. A marketplace is paid through checkout, so the engine skips supplier contact and payout-address checks for it (an explicit, tested rule). Checkout itself is not built. |

## Procurement core (`packages/procurement`)

Pure, deterministic and model-free. SERV will only ever choose among what this layer allows.

- **Evidence** (`evidence.ts`): missing evidence is `null` (unknown), never true. Expired evidence is ignored. A failure beats a success.
- **Eligibility** (`eligibility.ts`): hard failures make a quote `ineligible`; unknown identity, contact or payment evidence makes it `review_required`. A missing delivery history is a concern, not a blocker.
- **Comparison** (`comparison.ts`): ranks only eligible quotes. Savings are "estimated" against a stated baseline (highest eligible quote), never realised. A `review_required` quote is never recommended automatically.
- **Purchase order** (`purchase-order.ts`): every figure recomputed from unit prices. A total claimed by the UI or a model is only cross-checked. A supplier whose stated subtotal disagrees with its unit prices is rejected. Currency conversion needs an explicit, fresh rate supplied by the server.
- **Services** (`services/`): sourcing is idempotent; ordering refuses ineligible quotes; approval needs a human-approved payout address and records the order fingerprint.

A payout address is only ever proposed by a provider. A person approves it (`approvals:decide`).
| 6 Kite Passport | Built. Agent identity, policy-checked spending sessions with passkey approval, real Amazon checkout from the Passport wallet, paid seller checks and real phone calls, all on the `kpass` CLI (Kite has no HTTP API). Each paid path is tested end to end with a fake `kpass`; none has yet run with real funds. |
| 7 Worker | Not started. |
| 8 Security and tests | Partly: database, policy, money and state-machine tests exist. |
| 9 Deployment | Files ready (`Dockerfile`, `render.yaml`, [deploy.md](deploy.md)). Needs a host that can run the `kpass` CLI. Not deployed yet. |

## Frontend

- **Live and demo share one data interface** (`apps/web/lib/queries.ts`). Components never know which mode they are in. Live calls `/api`; demo reads an in-browser store (`lib/demo/store.ts`) with the same shapes.
- **Demo runs the real engine.** The store imports `@procura/procurement/core` (a browser-safe entry point with no database code), so the demo's comparison, eligibility and purchase orders come from the same functions the server uses. Only persistence and the Kite payment are simulated.
- **Honest about what is not connected.** Live mode shows Kite Passport as "not connected" (nothing can be paid) and SERV Reasoning as connected only when a key is set; without one the assistant will not interpret free text. A control that would need them is disabled and says why.
- **No invented numbers.** Dashboard and intelligence figures are derived from real orders and requests. Savings are labelled estimated and use a stated baseline.
- **Sessions:** `app/(app)/layout.tsx` resolves the session and business on the server for every protected screen. Role checks in the UI only hide controls; the API enforces them.
- **Local development without Neon:** `scripts/dev-db.mjs` serves PGlite over a socket and the app drops to the `procura_app` role per transaction, so Row Level Security is enforced locally too.

## Real checkout and real calls

Both go through `kpass` and both are designed so that nothing can move money or ring a phone by accident.

**Paying an Amazon order** (`apps/web/lib/server/checkout-live.ts`, `passport-shop.ts`):

1. Needs your approval, then the explicit "Pay with Kite" confirmation.
2. Wallet must hold the whole up-front charge: the ceiling (items plus up to the larger of 20% or $5, or a lower ceiling you choose or the wallet forces) plus Kite's $1 fee. What the order does not use is refunded.
3. An active session at least as large as the charge, and Procura's own gate: approval fingerprint unchanged, limits, no earlier payment.
4. Delivery details complete, then the Passport cart is cleared, filled with exactly the order's products and re-read. If a price or item differs, nothing is charged.
5. The attempt is recorded as `submitted` and the order moves to `payment pending` before `shop:checkout` runs, so a crash cannot allow a second payment. An unknown outcome leaves it `pending`; a clean refusal leaves it `failed` and retryable.
6. Success records the transaction hash, marks the order `paid` and counts against the monthly limit. A practice checkout never does.

**Phoning a seller** (`apps/web/lib/server/calls.ts`, `packages/procurement/src/calls.ts`): StablePhone through `session execute`, $0.54 a call. Only to the seller's saved international number; never to a demo seller or a marketplace; the task opens with fixed safety rules and an AI disclosure; any line that promises payment is removed on the server; three minutes at most; not recorded; at most two calls an hour per seller and five per user. Tested in `tests/integration/real-checkout.test.ts`.

## Known gaps

- Email provider (verification, invitations, reset links print to the server console in development). Email verification is switched off for now.
- Billing, and editing delivery details outside checkout.
- A per-user Passport worker for real multi-user use: one `kpass` login serves one account today.
- Background worker and realtime events (Phase 7): sourcing currently runs inline in the request.
- No automated browser tests yet; the screens were verified manually.

## Supplier verification (paid checks)

A supplier added by hand starts as "supplier provided". It becomes verified only through evidence, bought one lookup at a time from an approved Kite Passport session:

| Check | Service | Listed price | Evidence it can produce |
| --- | --- | --- | --- |
| Sanctions screening | tbs-digital `/screen/entity` | $0.001 | A possible match fails the identity check. A clear result is "unverified": it rules out a listed name, nothing more. |
| Company registry | GLEIF resolve (oblique.markets) | $0.01 | Verified only when the registry names the same business and it is active. Not found is "unverified", not "failed". |
| Email deliverability | toolcall.click `/t/email/validate` | $0.004 | Verified only when the address can receive mail and is not a throwaway domain. It does not prove ownership. |

Rules, all unit tested in `tests/unit/verification.test.ts`:

- The pure logic (plans, exact-decimal prices, URL guard, answer parsing) lives in `packages/procurement/src/verification.ts`. An answer that cannot be read is "unknown", never "verified", and a service's own match score is never trusted without the name matching.
- `POST /api/suppliers/:id/verify` needs `passport:manage`, a named active session, and the total the person saw (`maxCost`). A higher price is refused with `PRICE_CHANGED`. Each paid call carries an idempotency key that is stable for the same payment on the same day, so a retry cannot be charged twice.
- Money or session problems (empty wallet, limit, inactive session, pending payment) stop the remaining checks. Evidence is replaced per check, expires after 30 days, and every spend is written to the audit log.
- The response parsers were written against the services' documented field names. They have not yet read a real paid reply, because the Passport wallet is empty. The first funded run should be checked by hand.
