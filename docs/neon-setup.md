# Neon setup

Procura uses Neon Postgres instead of Supabase. You need to do this once.

## 1. Create the project

Create a Neon project and note two connection strings from the dashboard:

- **Direct (unpooled)** host, for migrations.
- **Pooled** host (contains `-pooler`), for the running app.

## 2. Create the application role (important)

Row Level Security is what stops one business reading another's data. It only applies if the app
connects as a role that is **not** the table owner and does **not** have `BYPASSRLS`. Neon's
default `neondb_owner` role is not suitable for the app.

Run this once in the Neon SQL editor, **before** the first migration, using a real password:

```sql
CREATE ROLE procura_app LOGIN PASSWORD 'choose-a-long-random-password';
```

Migration `0001_rls_and_guards.sql` detects the role and grants it the minimum privileges. If you
created the role after migrating, run the grant block at the bottom of that file by hand.

Check it is not a superuser or RLS-bypassing role:

```sql
SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'procura_app';
-- both flags must be false
```

## 3. Environment

Create a `.env` at the repo root and set:

| Variable | Value |
|---|---|
| `DATABASE_URL` | Pooled URL for `procura_app` |
| `MIGRATION_DATABASE_URL` | Direct URL for `neondb_owner` |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` |
| `BETTER_AUTH_URL`, `NEXT_PUBLIC_APP_URL` | The app's public address, such as `http://localhost:3000` |
| `REQUIRE_EMAIL_VERIFICATION` | `false` only for local development without an email provider |
| `SERV_API_KEY`, `SERV_BASE_URL`, `SERV_MODEL` | SERV Reasoning, from console.openserv.ai. Without a key the agent is off |
| `KPASS_BIN`, `PASSPORT_HOME`, `PASSPORT_BUSINESS_ID` | The `kpass` CLI path, the folder holding its login, and the one account allowed to use it |
| `ALLOW_FIXED_USD_PEG` | `true` only for demos: treats 1 USD as 1 USDC.e. Leave `false` otherwise |
| `PAYMENT_TOKEN_ADDRESS`, `DEMO_RECIPIENT_ADDRESS` | Optional wallet settings (0x + 40 hex) |

There is deliberately no committed template. Never commit `.env`.

## 4. Migrate

```bash
pnpm db:migrate
```

## 5. Verify

```bash
pnpm dev
curl http://localhost:3000/api/health   # {"success":true,"data":{"status":"ok","database":"up",...}}
```

## Why WebSockets

The app uses `@neondatabase/serverless` over WebSockets (`Pool`), not the HTTP driver. Tenant
isolation depends on setting `app.current_business_id` for the duration of one transaction, and
the HTTP driver cannot hold an interactive transaction open.

## Realtime

Neon has no Supabase-style Realtime. Agent progress is persisted to `agent_events` first, then
streamed to the browser (server-sent events, with polling fallback) in Phase 7. The UI can always
rebuild task progress from the persisted rows.
