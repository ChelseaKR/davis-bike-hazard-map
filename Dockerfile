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
CMD ["npx", "tsx", "server/index.ts"]
