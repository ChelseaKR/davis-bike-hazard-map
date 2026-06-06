/**
 * Prometheus metrics (RED + the moderation backlog gauges) via prom-client.
 *
 * Exposes per-request rate/errors/duration (a histogram, labelled by method,
 * route pattern, and status) plus Node/process defaults, alongside the
 * moderation-queue gauges that drive the SLA alerts. Route labels use the
 * Fastify route *pattern* (not the raw URL) to keep cardinality bounded.
 */
import { Registry, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';

export interface Metrics {
  registry: Registry;
  httpDuration: Histogram<'method' | 'route' | 'status'>;
  queueDepth: Gauge;
  oldestPending: Gauge;
}

export function createMetrics(): Metrics {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry });

  const httpDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds.',
    labelNames: ['method', 'route', 'status'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
    registers: [registry],
  });

  const queueDepth = new Gauge({
    name: 'dbhm_moderation_queue_depth',
    help: 'Reports awaiting moderation.',
    registers: [registry],
  });

  const oldestPending = new Gauge({
    name: 'dbhm_oldest_pending_age_seconds',
    help: 'Age of the oldest unmoderated report.',
    registers: [registry],
  });

  return { registry, httpDuration, queueDepth, oldestPending };
}
