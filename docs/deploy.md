# Deploying Procura

Procura pays and shops by running Kite's `kpass` command-line tool on the server. That decides where it can
run: **not on serverless hosting** (Vercel, Netlify and similar), because it needs a long-lived process, the
CLI installed, and a disk that keeps the CLI's login between restarts. Render, Railway, Fly or a small VM all
work. The repo includes a `Dockerfile` and a `render.yaml` blueprint. Neither has been run end to end yet, so
treat the first deploy as something to watch.

## What you need

- A Neon database set up as in [neon-setup.md](neon-setup.md), migrated with `pnpm db:migrate`.
- A SERV API key (the agent is off without one).
- A host that runs the Dockerfile and mounts a persistent disk at `/data`.

## Steps

1. Create the service from `render.yaml` (or your host's equivalent). Enter every `sync: false` value in the
   dashboard: `DATABASE_URL`, `MIGRATION_DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`,
   `NEXT_PUBLIC_APP_URL`, `SERV_API_KEY`. Leave `PASSPORT_BUSINESS_ID` empty for now.
2. Open a shell on the running service and sign the CLI in. This is manual on purpose: it needs the email
   code Kite sends you.

   ```bash
   export PASSPORT_HOME=/data/passport && cd "$PASSPORT_HOME"
   /root/.kpass/bin/kpass login init --email you@example.com --client agent --no-interactive
   # enter the code from the email:
   KPASS_LOGIN_CODE=<code> /root/.kpass/bin/kpass login verify --login-id <id from the previous step>
   /root/.kpass/bin/kpass status
   ```

3. Sign up in the deployed app. Find that account's business id (it is shown in the server's response when
   Passport is not enabled for a business) and set `PASSPORT_BUSINESS_ID` to it, then redeploy. Only that
   account can use Passport, because one CLI login serves one account.
4. In the app, connect a wallet, fund the buyer, and approve a spending session. Search first, which is free.

## Settings that matter

| Setting | Value and why |
|---|---|
| `REQUIRE_EMAIL_VERIFICATION` | `false` for now. There is no email provider yet, so verification and password-reset emails cannot be sent. |
| `ALLOW_FIXED_USD_PEG` | `true`. Amazon orders are in USD and the payment asset is treated 1 to 1. Without it, ordering fails safely instead of guessing a rate. |
| `PASSPORT_HOME` | A folder on the persistent disk. The CLI's login lives in `.kite-passport` inside it and is never read or returned by the app. |
| `BETTER_AUTH_URL` and `NEXT_PUBLIC_APP_URL` | The public address of the deployed app. |

## Before showing it to anyone

- The Passport backend here is **production**. Funding the wallet funds real money. Start with a few dollars.
- A real Amazon checkout holds the order plus a buffer and a $1 fee up front. With about $4 you can pay for a
  small order only, because the ceiling is lowered to what the wallet can hold. Seller checks cost cents and a
  call costs about 54 cents.
- Anyone who can sign in to the deployed app can search and compare. Only the account named in
  `PASSPORT_BUSINESS_ID` can pay, check sellers or place calls.
