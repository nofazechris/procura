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

Copy `.env.example` to `.env` and set:

| Variable | Value |
|---|---|
| `DATABASE_URL` | Pooled URL for `procura_app` |
| `MIGRATION_DATABASE_URL` | Direct URL for `neondb_owner` |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` |

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
