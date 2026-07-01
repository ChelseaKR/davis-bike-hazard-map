/**
 * Server-side Sentry forwarding. The transport (@sentry/node) is mocked so we
 * assert the gate behaviour — nothing is forwarded until a DSN is configured,
 * and once it is, server and client errors are shaped correctly — without ever
 * phoning home. `enabled` is module-level, so these run in order: disabled
 * first, then enabled.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@sentry/node', () => ({
  init: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

import * as Sentry from '@sentry/node';
import { initSentry, captureError, captureClientError } from '../../server/lib/sentry.ts';

describe('server Sentry gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('captureError is a no-op before initialisation (dev/test never phone home)', () => {
    captureError(new Error('x'), { hazardId: 'h1' });
    captureClientError({ message: 'render failed' });
    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('initSentry with an empty DSN stays disabled', () => {
    initSentry('', 'test');
    expect(Sentry.init).not.toHaveBeenCalled();
    captureError(new Error('x'));
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('initSentry with a DSN enables exception forwarding (with optional context)', () => {
    initSentry('https://key@example.ingest/1', 'production');
    // Default trace sampling is non-zero (traces flow) and PII scrubbing stays on.
    expect(Sentry.init).toHaveBeenCalledWith({
      dsn: 'https://key@example.ingest/1',
      environment: 'production',
      tracesSampleRate: 0.1,
      sendDefaultPii: false,
    });

    const err = new Error('boom');
    captureError(err, { hazardId: 'h1' });
    expect(Sentry.captureException).toHaveBeenCalledWith(err, { extra: { hazardId: 'h1' } });

    // No context -> no `extra` wrapper.
    captureError(err);
    expect(Sentry.captureException).toHaveBeenLastCalledWith(err, undefined);
  });

  it('honours an env-configured trace sample rate (still non-zero)', () => {
    initSentry('https://key@example.ingest/2', 'production', 0.25);
    expect(Sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({ tracesSampleRate: 0.25, sendDefaultPii: false }),
    );
  });

  it('captureClientError forwards a tagged, origin-marked message', () => {
    captureClientError({ message: 'render failed', source: 'react-error-boundary' });
    expect(Sentry.captureMessage).toHaveBeenCalledWith('client: render failed', {
      level: 'error',
      extra: { message: 'render failed', source: 'react-error-boundary' },
      tags: { origin: 'client', source: 'react-error-boundary' },
    });

    // Falls back to safe defaults when fields are missing.
    captureClientError({});
    expect(Sentry.captureMessage).toHaveBeenLastCalledWith(
      'client: error',
      expect.objectContaining({ tags: { origin: 'client', source: 'unknown' } }),
    );
  });
});
