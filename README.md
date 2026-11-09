# Procura

A safe AI buyer. Tell it what you need. It researches the options, you confirm, it pays from a capped
spending session you approve with your passkey, and when a seller has no website it can phone them.
It never holds your card or your keys, and it cannot spend a cent you have not approved.

```
research  ->  confirm  ->  pay  ->  call, if needed
```

1. **Research.** Live Amazon search through Kite Passport (free, buys nothing), a comparison on price and
   evidence, and optional paid seller checks (sanctions, company registry, email) that turn into evidence.
2. **Confirm.** Nothing happens without you. You approve the order, and the approval is sealed with a
   fingerprint of everything payable, so a change of even one cent voids it.
3. **Pay.** The agent pays Amazon from its own Kite Passport wallet, inside a session you approve with a
   passkey. Passport enforces the session's limits, and Procura checks everything first.
4. **Call, if needed.** For a seller with no website, an AI calls them. It says it is an AI, only asks
   questions, never agrees to buy, and only after you read the script and confirm.

Built for the Kite track: *agents with a verifiable identity and spending limits you control, so they can
shop and pay on your behalf, safely.*

## What is real

| Piece | State |
|---|---|
| Amazon search, comparison, evidence rules, approvals, limits | Live, tested |
| Kite Passport identity, spending sessions, passkey approval | Live, tested against the real service |
| Practice checkout (full payment gate, nothing charged) | Live, tested |
| Real Amazon checkout from the Passport wallet | Built and tested with a fake `kpass`. Needs a funded wallet to run for real |
| Seller checks (sanctions, registry, email) | Built and tested with fake replies. Parsers follow the services' documented fields; check the first real reply |
| Real phone calls (StablePhone) | Built and tested with a fake `kpass`. Needs a funded wallet to run for real |
| Funding the buyer from your wallet | Built. The USDC transfer prompt needs a browser wallet to try |

Real checkout holds the order total plus a buffer up front and refunds what is not used (Kite's rule:
cap = items + the larger of 20% or $5, plus a $1 fee). With a small wallet Procura lowers the ceiling to
what the wallet can hold, as long as it still covers the items and the fee.

## Stack

- **App:** Next.js 16 (App Router), React 19, TypeScript, TanStack Query, three.js
- **Data:** Neon Postgres with Row Level Security (Drizzle ORM)
- **Auth:** Better Auth (self-hosted)
- **Reasoning:** SERV Reasoning, to read a request and explain a comparison and draft a call script
- **Identity, spending limits and payments:** Kite Passport, driven through its `kpass` CLI

See [docs/architecture.md](docs/architecture.md) for the design, [docs/deploy.md](docs/deploy.md) to run it
somewhere other than your laptop, and [docs/demo-script.md](docs/demo-script.md) for a walkthrough.

## Layout

```
apps/web             Next.js app: screens, components, API route handlers
packages/shared      Money (no floats), statuses, state machines, Zod schemas, permissions
packages/policies    Deterministic spending policy, payment gate, checkout rules, order fingerprint
packages/procurement Evidence, eligibility, comparison, verification and call rules, services
packages/database    Drizzle schema, migrations, tenant-scoped client
tests/               unit and integration tests (in-process Postgres via PGlite)
scripts/dev-db.mjs   Local Postgres for development, no Neon needed
docs/                architecture, setup, deploy, demo script
```

## Run it locally

```bash
pnpm install
pnpm dev:db        # terminal 1: local Postgres on :5433 (applies migrations, keeps data in .data/)
pnpm dev           # terminal 2: the app on http://localhost:3000
```

Create a `.env` at the repo root. [docs/neon-setup.md](docs/neon-setup.md) lists every variable by name
and purpose. For local use with no email provider, set `REQUIRE_EMAIL_VERIFICATION=false`. No env file
is committed to this repository.

## How the product flows

- **Landing page.** A scroll-driven 3D story plays a whole purchase on a sample scenario computed by the real
  engine. Below it, interactive sections run the real rules in your browser. There is no demo dashboard.
- **Setup.** After sign-up a short wizard asks where you are, how the buyer should choose, your limits, and
  requires you to connect a wallet. Home then shows a "Get set up" dialog until the buyer can pay.
- **Wallet, funding and sessions.** These open as dialogs from Home and the top bar. Kite cannot pull money
  from your wallet, so you fund the buyer by sending USDC on Base to its Passport address. A spending
  session is the limit you approve with your passkey.
- **Limits.** Monthly limit, largest purchase, when it must ask you, and how it chooses between options.

## Safety rules the code enforces

- The model only drafts and explains. It never sets a limit, approves or pays.
- Money is decimal strings and integers, never floats. Unknown evidence is never read as verified.
- A real payment needs, in order: your approval, an unchanged order fingerprint, your limits, a wallet that
  holds the up-front charge, an active session big enough for it, a cart that matches the order exactly, and
  your explicit confirmation. Passport then enforces the session again.
- Each real attempt is recorded before money can move. If the outcome is unknown, the payment stays pending
  and the order cannot be paid a second time.
- A call goes only to the number saved on the seller. The script is cleaned again on the server, any line
  that promises payment is removed, and the call is capped at three minutes and is not recorded.
- Env values and the Passport login are server-side only, and the login token is never read or returned.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` / `pnpm build` | Run / build the web app |
| `pnpm dev:db` / `pnpm dev:db:reset` | Start / wipe the local database |
| `pnpm typecheck` | Typecheck every package |
| `pnpm test` | Unit and integration tests |
| `pnpm db:generate` / `pnpm db:migrate` | Generate / apply migrations (Neon) |

## Screens

Landing, sign in and sign up, Home, Requests (new, details, compare), Orders (details, PDF, pay), Sellers
(directory, profile with checks and calls), Spending, Activity, Ask Procura, Waiting for you, and Limits.
Command menu on Ctrl or Cmd+K.

## Security notes

- Secrets are server-side only. Nothing sensitive is in a `NEXT_PUBLIC_` variable.
- On Neon the app must connect as the non-owner `procura_app` role, or Row Level Security does not protect tenants.
- One `kpass` login serves one account, so only the account named in `PASSPORT_BUSINESS_ID` can pay. Real
  multi-user use needs a per-user Passport worker or an HTTP API from Kite.
- The audit log is append-only by design. Test accounts cannot be deleted.
