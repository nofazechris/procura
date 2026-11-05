# Procura

A safe AI buyer for small businesses. Describe what you need to buy; an agent finds options
(live Amazon search through Kite Passport, plus supplier checks), compares them on evidence and
price, and explains its pick. When it is time to pay, the agent can only spend what you approve:
Kite Passport gives it a verifiable identity and a capped spending session that you activate
with your passkey. The agent never holds your card or your keys.

- **App:** Next.js 16 (App Router), React 19, TypeScript, TanStack Query, Lucide
- **Data:** Neon Postgres with Row Level Security (Drizzle ORM)
- **Auth:** Better Auth (self-hosted)
- **Reasoning:** SERV Reasoning (connected when `SERV_API_KEY` is set; see below)
- **Identity and spending limits:** Kite Passport (agent identity and capped sessions work; checkout is next)

See [docs/architecture.md](docs/architecture.md) for what is built and what is not.

## Layout

```
apps/web            Next.js app: screens, components, API route handlers
packages/shared     Money (no floats), statuses, state machines, Zod schemas, permissions
packages/policies   Deterministic financial policy engine, order fingerprint
packages/procurement Evidence, eligibility, comparison, purchase orders, demo supplier provider, services
packages/database   Drizzle schema, migrations, tenant-scoped client
tests/              unit + integration (in-process Postgres via PGlite)
scripts/dev-db.mjs  Local Postgres for development, no Neon needed
prototype/          the original clickable design
docs/               architecture, Neon setup
```

## Run it locally

```bash
pnpm install
pnpm dev:db        # terminal 1: local Postgres on :5433 (applies migrations, keeps data in .data/)
pnpm dev           # terminal 2: the app on http://localhost:3000
```

`.env` is already set for local development (gitignored). For a real deployment see
[docs/neon-setup.md](docs/neon-setup.md), which lists every variable.

### Landing page, sign-in and first run

The landing page tells the product's story on a fictional sample scenario, computed by the real
engine: a shop buying a label printer, a charger and label rolls. A scroll-driven 3D rack (three.js,
procedural geometry, no model files) plays the whole purchase: request, find, prove, compare,
order, your passkey, and a capped payment. Below it, four interactive 3D sections run the *real*
rules in your browser: the basket rule that picks listings, the eligibility engine, the comparison
engine with a budget plane, and the payment gate with attacks. There is no demo dashboard: "See it
run" asks the visitor to create an account.

The same rack plays on a slow loop behind the sign-in and sign-up forms. After sign-up, a
two-pane setup wizard opens over the dashboard where the rack builds itself step by step as you
answer (business, what you buy, how it chooses, limits, wallet, ready). It cannot be dismissed
until the business exists, and the wallet step is optional. Afterwards the dashboard shows a "Get
set up" checklist.

### The agent (SERV Reasoning)

With `SERV_API_KEY` set, the agent does two jobs, through `POST /v1/chat/completions` with strict
JSON-schema output (`apps/web/lib/server/serv.ts`):

- **Reads a plain-language request** ("50 bags of rice, budget $2,000, by Friday") and fills in the
  request form. A person reviews it before anything is created. Every value is re-validated on the
  server; anything unclear is dropped and reported, never guessed.
- **Explains a comparison** in plain English. It is given only what the deterministic engine
  computed and may cite only an eligible quote. The engine's ranking stays the authority.

The model never sets a spending limit, approves, or pays. Calls are rate limited per user and
recorded in the audit log (model and token usage, not the text). Defaults: base URL
`https://inference-api.openserv.ai`, model `gpt-5.4-mini` (override with `SERV_BASE_URL` / `SERV_MODEL`).

### Kite Passport (agent identity and spending limits)

Settings, Passport. Kite Passport has **no public HTTP API**; the `kpass` CLI is the only way in, so
Procura drives it as a child process (`apps/web/lib/server/passport.ts`: argument arrays, no shell,
the login token is never read or returned).

- **Verifiable identity:** Procura's agent (`procura-agent`) is registered under the owner's Passport
  account, and the id Passport issues is recorded and shown.
- **Spending limits you control:** a person requests a session with a per-payment limit, a total and a
  duration. Procura first refuses anything wider than the business's own spending policy
  (`evaluateSessionRequest`), then asks Passport, which enforces the caps. The session becomes
  active only when Passport reports the person approved it with their passkey; nothing a client
  sends can do that.
- **Not wired yet:** executing payments. The Passport backend here is **production** and the
  wallet is empty, so approving a session sets a limit and moves no money.

Setup: `KPASS_BIN`, `PASSPORT_HOME` (the folder holding its gitignored `.kite-passport` login) and
`PASSPORT_BUSINESS_ID`. One login serves one business, so only that business can use it; real
multi-tenant use needs a per-business Passport worker or an HTTP API from Kite.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` / `pnpm build` | Run / build the web app |
| `pnpm dev:db` / `pnpm dev:db:reset` | Start / wipe the local database |
| `pnpm typecheck` | Typecheck every package |
| `pnpm test` | Unit and integration tests |
| `pnpm db:generate` / `pnpm db:migrate` | Generate / apply migrations (Neon) |

## Screens

Landing, sign in / sign up / password recovery, overview (with the setup wizard on first login), procurement (list, new,
workspace, comparison), suppliers (directory, profile), purchase orders (list, detail, PDF
export), approvals, payments (list, detail), intelligence, activity, AI assistant, and settings
(business, team, agent permissions, integrations). Command menu on Ctrl/Cmd+K.

## API

All responses use `{ success, data?, error? }`. Every route authenticates, resolves the caller's
business membership, and checks a role permission on the server.

| Route | Purpose |
|---|---|
| `/api/auth/*` | Better Auth: sign up, sign in, verify, reset |
| `GET, POST /api/business`, `GET, PATCH /api/business/:id`, `GET .../members` | Businesses and team |
| `GET, PATCH /api/policy` | Spending limits |
| `GET, POST /api/procurement`, `GET /:id`, `POST /:id/sourcing`, `GET /:id/comparison`, `POST /:id/cancel` | Requests and sourcing |
| `GET /api/suppliers`, `GET /:id`, `POST /:id/payout-destinations/:destId/approve` | Suppliers, evidence, payment addresses |
| `GET, POST /api/orders`, `GET /:id`, `POST /:id/approve`, `POST /:id/reject` | Purchase orders |
| `GET /api/approvals`, `GET /api/payments`, `GET /api/activity` | Approvals, payments, audit trail |
| `GET /api/health` | Liveness and database check |

## Security notes

- Secrets are server-side only. Nothing sensitive is in a `NEXT_PUBLIC_` variable.
- On Neon the app must connect as the non-owner `procura_app` role or RLS does not protect tenants.
- The AI never approves or executes a payment; the policy engine, a human and Kite Passport do.
- Demo suppliers are fictional and labelled `source_type = 'demo'` everywhere they appear.
