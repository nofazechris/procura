# Procura

Autonomous procurement: describe what your business needs, and an agent sources suppliers,
compares quotes and pays within spending authority you control.

- **App:** Next.js 16 (App Router), React 19, TypeScript, TanStack Query, Lucide
- **Data:** Neon Postgres with Row Level Security (Drizzle ORM)
- **Auth:** Better Auth (self-hosted)
- **Reasoning:** SERV Reasoning (not connected yet)
- **Payments:** Kite Passport (not connected yet)

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

`.env` is already set for local development (gitignored). For a real deployment use
`.env.example` and [docs/neon-setup.md](docs/neon-setup.md).

### Landing page and first run

The landing page is a scroll-driven 3D story (three.js, procedural geometry, no model files):
six agent modules joined edge to edge, with a request packet travelling through them. Every
number on it comes from the real engine at build time, and the "Break it yourself" and
"Authority rings" sections run the real comparison and payment-gate code in the visitor's
browser. There is no demo dashboard: "See it run" asks the visitor to create an account.

Signing up lands on the dashboard with a setup wizard modal (business, requirements,
preferences, financials). It cannot be dismissed until the business exists; afterwards the
dashboard shows a "Get set up" checklist. Everything that needs SERV or Kite is shown as "not
connected", never faked. A demo-mode cookie (`procura_mode=demo`) still exists for development
but nothing in the UI links to it.

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
