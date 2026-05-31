/**
 * Server configuration, read from the environment with safe defaults.
 *
 * Secrets (the moderator token, any 311 webhook secret) come ONLY from the
 * environment — never hard-coded. In development a random-ish dev token is
 * generated and logged so the moderation panel is usable out of the box.
 */
import { randomUUID } from 'node:crypto';

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

const isProd = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';

export const serverConfig = {
  isProd,
  isTest,
  port: int('API_PORT', int('PORT', 8787)),
  host: process.env.HOST ?? '0.0.0.0',

  /** Where the JSON-backed store persists. Empty => in-memory (tests/dev). */
  dataFile: process.env.DATABASE_PATH ?? (isProd ? './data/hazards.json' : ''),

  /** Moderator bearer token. Required in production. */
  moderationToken: process.env.MODERATION_TOKEN ?? (isProd ? '' : `dev-${randomUUID()}`),

  /** Optional 311/GOGov hand-off webhook. Empty => hand-off runs in dry-run. */
  gogovWebhookUrl: process.env.GOGOV_WEBHOOK_URL ?? '',
  gogovApiKey: process.env.GOGOV_API_KEY ?? '',

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
} as const;
