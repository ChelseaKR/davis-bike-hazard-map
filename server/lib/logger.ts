/**
 * Structured logging configuration (per OBSERVABILITY-STANDARD §3).
 *
 * Fastify logs through Pino, which already emits newline-delimited JSON
 * (`time`, `level`, `msg`, `reqId`, `req.method`, `req.url`, `res.statusCode`,
 * `responseTime`). This module supplies the two things the standard adds on top:
 *
 *   1. A production-enabled logger (level from LOG_LEVEL, default `info`);
 *      disabled in tests so unit runs stay quiet.
 *   2. A hard redaction allow-list so the log stream can NEVER carry the
 *      privacy-sensitive or secret fields this app handles — precise
 *      coordinates, auth headers/cookies, session tokens, passwords, shared
 *      secrets. This is the non-negotiable "no secrets/PII in logs" gate.
 */
import type { FastifyServerOptions } from 'fastify';

/** OTEL_SERVICE_NAME for this API surface. */
export const SERVICE_NAME = 'davis-bike-hazard-map';

/**
 * Fields that must be censored wherever they appear in a log record.
 *
 * Paths cover both the top level and one level of nesting (`*.field`) so a
 * hazard/report object logged as a child key is scrubbed too. `req.headers.*`
 * catches Fastify's request serializer output. Coordinates are treated as
 * sensitive: `preciseLocation` (the un-fuzzed point) and any raw `location`
 * (a submission carries the reporter's precise point) never reach the logs.
 */
export const LOG_REDACT_PATHS: string[] = [
  // Auth material on the incoming request.
  'req.headers.authorization',
  'req.headers.cookie',
  'authorization',
  '*.authorization',
  'cookie',
  '*.cookie',
  // Session tokens / credentials / shared secrets.
  'token',
  '*.token',
  'password',
  '*.password',
  'passwordHash',
  '*.passwordHash',
  'sessionSecret',
  '*.sessionSecret',
  'secret',
  '*.secret',
  'apiKey',
  '*.apiKey',
  // Precise / raw geolocation (privacy invariant: never log the un-fuzzed point).
  'preciseLocation',
  '*.preciseLocation',
  'location',
  '*.location',
];

/** The redaction config applied to the server's Pino logger. */
export const LOG_REDACT = { paths: LOG_REDACT_PATHS, censor: '[redacted]' } as const;

/**
 * Build the Fastify logger option for the given config.
 *
 * - Tests: `false` (no request logging noise; unit tests assert behaviour, not
 *   log output — the redaction contract is tested explicitly instead).
 * - Everything else (incl. production): structured JSON at LOG_LEVEL (default
 *   `info`) with the redaction allow-list above.
 */
export function buildLoggerOptions(config: { isTest: boolean }): FastifyServerOptions['logger'] {
  if (config.isTest) return false;
  return {
    level: process.env.LOG_LEVEL ?? 'info',
    redact: { paths: LOG_REDACT_PATHS, censor: '[redacted]' },
  };
}

/**
 * Emit a single structured JSON line for a fatal condition that happens BEFORE
 * the Fastify (Pino) logger exists — e.g. a missing-required-config guard at
 * boot. Keeps even the earliest failures machine-parseable instead of a bare
 * `console.error` string. Writes to stderr; the caller decides whether to exit.
 */
export function logBootFatal(message: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({
    level: 'fatal',
    time: new Date().toISOString(),
    name: SERVICE_NAME,
    msg: message,
    ...fields,
  });
  process.stderr.write(`${line}\n`);
}
