/**
 * Server configuration, read from the environment with safe defaults.
 *
 * Secrets (the moderator token, any 311 webhook secret) come ONLY from the
 * environment — never hard-coded. In development a random-ish dev token is
 * generated and logged so the moderation panel is usable out of the box.
 */
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

const isProd = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';

// Production store: PostgreSQL. When DATABASE_URL is set the Postgres repository
// is used (and it is REQUIRED in production — the server refuses to boot
// without it). Safe for multiple processes, unlike the JSON store below.
const databaseUrl = process.env.DATABASE_URL ?? '';

// JSON-backed store for dev/MVP. Empty => in-memory (tests/zero-config dev).
//
// IMPORTANT: the JSON file store assumes a SINGLE server process. Writes are
// atomic per process (temp + rename), but two processes pointed at the same
// file WILL corrupt it — there is no cross-process lock. Use Postgres
// (DATABASE_URL) for any multi-process deployment.
const dataFile = process.env.DATABASE_PATH ?? '';

export const serverConfig = {
  isProd,
  isTest,
  port: int('API_PORT', int('PORT', 8787)),
  host: process.env.HOST ?? '0.0.0.0',

  databaseUrl,
  dataFile,

  /** Secret used to sign moderator session tokens. Required in production. */
  sessionSecret: process.env.SESSION_SECRET ?? (isProd ? '' : `dev-secret-${randomUUID()}`),
  /** Moderator session lifetime. */
  sessionTtlMs: int('SESSION_TTL_HOURS', 12) * 60 * 60 * 1000,
  /** Optional bootstrap moderator, created on first boot if absent. */
  moderatorBootstrap: {
    username: process.env.MODERATOR_USERNAME ?? (isProd ? undefined : 'admin'),
    password: process.env.MODERATOR_PASSWORD ?? (isProd ? undefined : 'admin'),
  },

  /** Optional 311/GOGov hand-off webhook. Empty => hand-off runs in dry-run. */
  gogovWebhookUrl: process.env.GOGOV_WEBHOOK_URL ?? '',
  gogovApiKey: process.env.GOGOV_API_KEY ?? '',
  /** Optional 311 status-poll URL (GET {url}/{reference}). Empty => sync dry-runs. */
  gogovStatusUrl: process.env.GOGOV_STATUS_URL ?? '',
  /**
   * Shared secret a 311/GOGov webhook must present (x-gogov-signature header) to
   * push a status back. Empty => the inbound sync-back webhook is DISABLED (503),
   * so we never accept unauthenticated status writes.
   */
  gogovWebhookSecret: process.env.GOGOV_WEBHOOK_SECRET ?? '',

  /**
   * 311 hand-off provider selector (EXP-06). `gogov` (default) uses the
   * bespoke GOGov adapter above; `open311` uses the vendor-neutral Open311
   * GeoReport v2 adapter (`server/lib/open311.ts`) instead — config-only
   * switch, no code change, per the ideation doc's "switching providers is
   * config-only" excellence bar. Unknown values fall back to `gogov`.
   */
  handoffProvider: process.env.HANDOFF_PROVIDER === 'open311' ? 'open311' : ('gogov' as 'gogov' | 'open311'),
  /** Open311 GeoReport v2 base endpoint, e.g. https://311.example.gov/v2. Empty => dry-run. */
  open311Endpoint: process.env.OPEN311_ENDPOINT ?? '',
  open311ApiKey: process.env.OPEN311_API_KEY ?? '',
  /** Required by multi-jurisdiction Open311 servers; optional for single-tenant ones. */
  open311JurisdictionId: process.env.OPEN311_JURISDICTION_ID ?? '',
  /** The single Open311 `service_code` this app's reports map onto. */
  open311ServiceCode: process.env.OPEN311_SERVICE_CODE ?? 'bike-hazard',

  /**
   * OSRM-compatible cycling routing backend, proxied by GET /api/route. Default
   * is the public OSRM demo server (fine for dev/light use; self-host for prod
   * — see docs). Empty => the planner serves a straight-line fallback only.
   */
  routingUrl:
    process.env.ROUTING_URL ?? 'https://router.project-osrm.org/route/v1/cycling',

  /** How long a resolved hazard stays visible (greyed) on the public map, in days. */
  resolvedVisibleDays: int('RESOLVED_VISIBLE_DAYS', 7),

  /**
   * Web-push alerts for saved areas/routes. OFF by default — needs VAPID keys to
   * actually deliver; without them (or when disabled) the matcher still runs in
   * dry-run. See docs for the production checklist.
   */
  push: {
    enabled: process.env.PUSH_ENABLED === 'true',
    vapidPublicKey: process.env.VAPID_PUBLIC_KEY ?? '',
    vapidPrivateKey: process.env.VAPID_PRIVATE_KEY ?? '',
    subject: process.env.VAPID_SUBJECT ?? 'mailto:hazards@davisbikehazardmap.org',
  },

  /** Optional Sentry DSN for server-side error reporting. Empty => disabled. */
  sentryDsn: process.env.SENTRY_DSN ?? '',
  /**
   * Fraction (0..1) of transactions Sentry captures as performance traces.
   * Non-zero by default so traces actually flow (OBSERVABILITY-STANDARD flags a
   * `0` rate). Override with SENTRY_TRACES_SAMPLE_RATE; out-of-range => 0.1.
   */
  sentryTracesSampleRate: (() => {
    const raw = process.env.SENTRY_TRACES_SAMPLE_RATE;
    const n = raw !== undefined && raw !== '' ? Number(raw) : NaN;
    return Number.isFinite(n) && n >= 0 && n <= 1 ? n : 0.1;
  })(),

  /** Optional S3 / S3-compatible (R2, MinIO) object storage for photos. */
  s3: {
    bucket: process.env.S3_BUCKET ?? '',
    prefix: process.env.S3_PREFIX ?? 'photos/',
    endpoint: process.env.S3_ENDPOINT ?? '',
    region: process.env.S3_REGION ?? 'auto',
  },

  /** CORS allow-list for the dev client. Empty in prod (same-origin). */
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173,http://localhost:4173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  /** Where the built client lives, for the server to serve in production. */
  clientDir: process.env.CLIENT_DIR ?? './dist',
  serveClient: process.env.SERVE_CLIENT === 'true' || isProd,

  rateLimit: {
    max: int('RATE_LIMIT_MAX', 120), // requests
    windowMs: int('RATE_LIMIT_WINDOW_MS', 60_000),
    reportsPerHour: int('REPORTS_PER_HOUR', 30),
  },

  /** Hazard time-to-live (days) before auto-expiry, by severity. */
  ttlDays: {
    low: int('TTL_LOW_DAYS', 14),
    moderate: int('TTL_MODERATE_DAYS', 21),
    high: int('TTL_HIGH_DAYS', 30),
  },

  /**
   * Periodic timestamped snapshots of the JSON store (it has no PITR). Disabled
   * when running in-memory. Defaults to a `backups/` dir beside the data file.
   */
  backup: {
    dir: process.env.BACKUP_DIR ?? (dataFile ? join(dirname(dataFile), 'backups') : ''),
    intervalHours: int('BACKUP_INTERVAL_HOURS', 6),
    retain: int('BACKUP_RETAIN', 14),
  },
} as const;
