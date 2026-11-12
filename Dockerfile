# Procura on a normal Node host. The app pays and shops by running Kite's `kpass` CLI, so it cannot run on
# serverless hosting: it needs a long-lived process, the CLI, and a disk that keeps the CLI's login.
# See docs/deploy.md. This file has not been run end to end yet.
FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates bash jq \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable

WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build

# Kite Passport CLI. Its login lives in PASSPORT_HOME/.kite-passport on a persistent disk and is never baked into the image.
RUN curl -fsSL https://cli.gokite.ai/install.sh | bash
# PASSPORT_HOME is set by the host (render.yaml sets it on a plan with a disk). Left unset, Kite Passport is off.
ENV KPASS_BIN=/root/.kpass/bin/kpass \
    NODE_ENV=production \
    PORT=3000

EXPOSE 3000
CMD ["sh", "-c", "if [ -n \"$PASSPORT_HOME\" ]; then mkdir -p \"$PASSPORT_HOME\"; fi; exec pnpm --filter @procura/web exec next start -p ${PORT}"]
