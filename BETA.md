# Private Beta — runbook

How to stand up the private beta of the Davis Bike Hazard Map, hand out a
preview link, and run it safely while a small group tests it.

The app is one container (Fastify API that also serves the built PWA) plus a
PostgreSQL database. It is currently deployed on **AWS** (see below); the
**Fly.io** runbook that follows is the original target and works the same way on
any Docker host + managed Postgres.

---

## Live deployment (AWS App Runner + RDS)

**The private beta is live at <https://ffvp3ctt7m.us-west-2.awsapprunner.com>.**

It runs in `us-west-2`:

- **AWS App Runner** serves the container (image built from this repo's
  `Dockerfile`) on a managed HTTPS URL, egressing through a **VPC connector** so
  it can reach the database privately.
- **Amazon RDS for PostgreSQL** (`dbhm-pg`, db.t4g.micro, not publicly
  accessible). The app connects with **full TLS verification**
  (`sslmode=verify-full`); the Amazon RDS CA bundle is baked into the image via
  `NODE_EXTRA_CA_CERTS`.
- **Amazon S3** (`dbhm-photos-<acct>-us-west-2`) holds uploaded photos, reached
  through a free S3 gateway VPC endpoint (no NAT).
- Secrets (`DATABASE_URL`, `SESSION_SECRET`, `MODERATOR_PASSWORD`) live in **AWS
  Secrets Manager** under the `dbhm/` prefix, injected as runtime environment
  secrets. `MODERATOR_USERNAME` is a plain env var.

Smoke test:

```bash
curl https://ffvp3ctt7m.us-west-2.awsapprunner.com/api/health   # {"status":"ok"}
curl https://ffvp3ctt7m.us-west-2.awsapprunner.com/api/ready    # {"status":"ready"} (DB-aware)
```

Redeploy after a code change — rebuild the image, then roll App Runner:

```bash
# 1. refresh the build source, 2. build+push image, 3. redeploy
aws s3 cp <(git -C . archive HEAD) s3://dbhm-build-<acct>-us-west-2/source/dbhm-src.zip  # or zip the tree
aws codebuild start-build --project-name dbhm-image-build --region us-west-2
aws apprunner start-deployment --region us-west-2 \
  --service-arn arn:aws:apprunner:us-west-2:<acct>:service/davis-bike-hazard-map/<id>
```

The GitHub Actions Fly workflow (`.github/workflows/deploy.yml`) is unrelated to
this AWS deployment and stays inert unless a `FLY_API_TOKEN` secret is set.

---

## 1. One-time provisioning (Fly.io — alternative)

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
- **CodeQL** runs but its result upload needs **GitHub Advanced Security**,
  which private repos lack by default. Enable it under *Settings → Code security
  → Code scanning* (or when the repo goes public) to surface results, then make
  the job required.

## Rollback

```bash
fly releases                 # list deploys
fly deploy --image <prior>   # or: fly releases rollback <version>
```
