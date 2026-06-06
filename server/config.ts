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

  /** Optional Sentry DSN for server-side error reporting. Empty => disabled. */
  sentryDsn: process.env.SENTRY_DSN ?? '',

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
