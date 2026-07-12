# Multi-stage build: compile the PWA in a full-deps stage, then run the API
# (which also serves the built client) from a slim production-deps stage.

# --- build ---
FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# --- runtime ---
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8787

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
# npm is only needed to install: drop the bundled npm CLI (and its vendored
# node_modules — picomatch, sigstore, …) from the runtime layer so base-image
# npm CVEs can't ship in production (Trivy container-scan gate). The server is
# started with node directly below, so neither npm nor npx exists at runtime.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

# App code + built client. The server runs via tsx (a production dependency).
COPY --from=build /app/dist ./dist
COPY server ./server
COPY shared ./shared
COPY migrations ./migrations

# Trust the Amazon RDS certificate authorities so the Postgres client can do
# full TLS verification (DATABASE_URL sslmode=verify-full) against RDS. The
# bundle is fetched at build time; NODE_EXTRA_CA_CERTS appends it to Node's
# default trust store (public CAs still trusted). Chmod so the non-root `node`
# user can read it (ADD-from-URL defaults to 0600, root-owned).
ADD https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /etc/ssl/certs/rds-global-bundle.pem
RUN chmod 0644 /etc/ssl/certs/rds-global-bundle.pem
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/rds-global-bundle.pem

EXPOSE 8787
# Liveness: the API health endpoint.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

USER node
# Invoke tsx's CLI entry directly (exactly what `npx tsx` resolved to) — npm
# and npx are removed from this image above.
CMD ["node", "node_modules/tsx/dist/cli.mjs", "server/index.ts"]
