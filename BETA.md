# Private Beta — runbook

How to stand up the private beta of the Davis Bike Hazard Map, hand out a
preview link, and run it safely while a small group tests it.

The app is one container (Fastify API that also serves the built PWA) plus a
PostgreSQL database. Target host below is **Fly.io** (config already in
[`fly.toml`](./fly.toml)); any Docker host + managed Postgres works the same way.

---

## 1. One-time provisioning (Fly.io)

Requires a Fly account. `flyctl` is the CLI (`brew install flyctl` or
`curl -L https://fly.io/install.sh | sh`).

```bash
fly auth login                       # interactive, in your terminal

# Create the app from fly.toml (don't deploy yet).
fly launch --no-deploy --copy-config --name davis-bike-hazard-map --region sjc

# Provision Postgres and attach it (sets DATABASE_URL as a secret on the app).
fly postgres create --name davis-bike-hazard-db --region sjc --initial-cluster-size 1
fly postgres attach davis-bike-hazard-db --app davis-bike-hazard-map

# Required secrets: session signing key + the first moderator account.
fly secrets set \
  SESSION_SECRET="$(openssl rand -hex 32)" \
  MODERATOR_USERNAME="you" \
  MODERATOR_PASSWORD="$(openssl rand -base64 18)"   # save this — it's your login

fly deploy                            # builds the Dockerfile remotely and ships it
fly open                              # opens the live URL
```

Your preview link is `https://davis-bike-hazard-map.fly.dev`.

## 2. Continuous deploys (optional but recommended)

`.github/workflows/deploy.yml` redeploys on every push to `main` once you add a
token:

```bash
fly tokens create deploy -x 999999h          # prints a token
gh secret set FLY_API_TOKEN --app actions     # paste it when prompted
```

Until the secret exists the deploy job skips cleanly (stays green).

## 3. Smoke test the beta

```bash
curl https://davis-bike-hazard-map.fly.dev/api/health         # {"status":"ok"}
curl https://davis-bike-hazard-map.fly.dev/api/metrics         # queue gauges
```

Then in the app: file a report → open **Moderate**, sign in with your
`MODERATOR_*` credentials → approve it → confirm it appears on the Map/List.

## 4. Inviting testers

- It's a public URL but unlisted — share it directly with your beta group.
- No tester accounts: anyone can file and view reports (that's the product).
  Only **moderators** sign in; create more with additional `fly secrets set`
  bootstrap creds or by inserting into the `moderators` table.
- Ask testers to **install the PWA** (Add to Home Screen) so you exercise the
  offline-capture → sync path on real phones.

## 5. What to watch during the beta

- **Moderation backlog** — `GET /api/metrics`:
  `dbhm_moderation_queue_depth` and `dbhm_oldest_pending_age_seconds`. Review
  the queue within the **48 h SLA**. Wire the example alerts in
  [`docs/ops/prometheus-alerts.yml`](./docs/ops/prometheus-alerts.yml) if you
  have a Prometheus.
- **Errors** — set `SENTRY_DSN` to aggregate errors in Sentry: server errors
  and client crashes (beaconed to `/api/client-errors`, forwarded server-side so
  the PWA bundle stays lean) both land there. Without a DSN they go to the app
  logs (`fly logs`).
- **Metrics** — `GET /api/metrics` now serves full Prometheus output (RED
  request rate/errors/latency + Node defaults, plus the backlog gauges).
- **Health** — `GET /api/health` behind an uptime check.

## 6. Beta data & privacy notes

- Photos are EXIF-stripped (client + server) and faces/plates are blurrable;
  precise location is fuzzed to ~70 m before anything is public. See
  [`docs/audits/`](./docs/audits/).
- Postgres holds reports + the precise (internal-only) coordinates; use Fly's
  managed Postgres backups. Photos live in the app volume by default; set
  `S3_BUCKET` (+ AWS creds / `S3_ENDPOINT` for R2/MinIO) to move them to object
  storage so app machines stay stateless and you can put a CDN in front.
- Before a **public** launch, complete the two open review-gated items: the
  human VoiceOver/NVDA pass ([`screen-reader-walkthrough.md`](./docs/audits/screen-reader-walkthrough.md))
  and the equity-reviewer sign-off on the coverage view.

## CI notes (two non-blocking jobs)

- **WebKit e2e** is non-blocking: WebKit-on-Linux fails to render headlessly in
  CI (a tooling issue, not a product bug — Chromium + Firefox are the required
  gate). Real Safari/iOS coverage is the manual device pass before public launch.
- **CodeQL** analyzes application code and workflows and publishes results to
  the Security tab. The repository is public, so code scanning is available;
  keep both matrix jobs green even though they are not currently required by
  the `protect-main` ruleset.

## Branch protection (active)

The public repository already has an active `protect-main` ruleset. It blocks
force-pushes and deletion of `main` and requires seven checks: Node 20, Node 22,
Chromium + Firefox e2e, security, Lighthouse, workflow SAST, and standards.
Inspect the live rule before changing it:

```bash
gh api repos/ChelseaKR/davis-bike-hazard-map/rulesets \
  --jq '.[] | {id, name, enforcement}'
```

[`docs/ops/branch-ruleset.json`](./docs/ops/branch-ruleset.json) mirrors the
live rule as a recovery/import template. POST it only if the live rule is
missing; creating it while `protect-main` already exists would duplicate the
policy. WebKit remains advisory and CodeQL remains visible but non-required.

## Rollback

```bash
fly releases                 # list deploys
fly deploy --image <prior>   # or: fly releases rollback <version>
```
