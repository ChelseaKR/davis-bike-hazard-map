import { describe, it, expect } from 'vitest';
import {
  signWebhookBody,
  verifyWebhook,
  ReplayCache,
  WEBHOOK_TOLERANCE_MS,
} from '../../server/lib/webhookAuth.ts';

const SECRET = 'top-secret';
const NOW = 1_700_000_000_000;
const BODY = '{"reference":"h1","status":"Resolved"}';

/** Build a valid verify-input for a body signed at `ts` (default: fresh, `NOW`). */
function input(body: string, ts: number, secret = SECRET) {
  return {
    secret,
    signatureHeader: signWebhookBody(secret, ts, body),
    timestampHeader: String(ts),
    rawBody: body,
    now: NOW,
  };
}

describe('verifyWebhook', () => {
  it('accepts a correctly-signed, fresh request and returns the signature', () => {
    const res = verifyWebhook(input(BODY, NOW));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.signature).toBe(signWebhookBody(SECRET, NOW, BODY));
  });

  it('accepts a timestamp at the very edge of the tolerance window', () => {
    expect(verifyWebhook(input(BODY, NOW - WEBHOOK_TOLERANCE_MS)).ok).toBe(true);
  });

  it('rejects a missing signature', () => {
    expect(verifyWebhook({ ...input(BODY, NOW), signatureHeader: undefined })).toMatchObject({
      ok: false,
      reason: 'missing_signature',
    });
  });

  it('rejects a missing timestamp', () => {
    expect(verifyWebhook({ ...input(BODY, NOW), timestampHeader: undefined })).toMatchObject({
      ok: false,
      reason: 'missing_timestamp',
    });
  });

  it('rejects a non-numeric timestamp', () => {
    expect(verifyWebhook({ ...input(BODY, NOW), timestampHeader: 'nope' })).toMatchObject({
      ok: false,
      reason: 'bad_timestamp',
    });
  });

  it('rejects a stale timestamp outside the window (signature still valid)', () => {
    expect(verifyWebhook(input(BODY, NOW - WEBHOOK_TOLERANCE_MS - 1))).toMatchObject({
      ok: false,
      reason: 'stale',
    });
  });

  it('rejects a signature lifted onto a different body (body-bound HMAC)', () => {
    const forged = { ...input(BODY, NOW), rawBody: '{"reference":"h1","status":"In Progress"}' };
    expect(verifyWebhook(forged)).toMatchObject({ ok: false, reason: 'bad_signature' });
  });

  it('rejects a signature made with the wrong secret', () => {
    expect(verifyWebhook({ ...input(BODY, NOW, 'other-secret'), secret: SECRET })).toMatchObject({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it('rejects the raw static secret used directly as the signature (old scheme)', () => {
    const res = verifyWebhook({
      secret: SECRET,
      signatureHeader: SECRET,
      timestampHeader: String(NOW),
      rawBody: BODY,
      now: NOW,
    });
    expect(res).toMatchObject({ ok: false, reason: 'bad_signature' });
  });

  it('folds the timestamp into the signature (can’t be swapped independently)', () => {
    // Sign at one timestamp, present a different (also-fresh) timestamp header.
    const signedAt = input(BODY, NOW);
    const res = verifyWebhook({ ...signedAt, timestampHeader: String(NOW + 1000) });
    expect(res).toMatchObject({ ok: false, reason: 'bad_signature' });
  });
});

describe('ReplayCache', () => {
  it('accepts a signature once and rejects a repeat', () => {
    const cache = new ReplayCache(WEBHOOK_TOLERANCE_MS);
    expect(cache.check('sig-a', NOW)).toBe(true);
    expect(cache.check('sig-a', NOW)).toBe(false);
    expect(cache.check('sig-b', NOW)).toBe(true);
  });

  it('prunes entries past their retention window so it stays bounded', () => {
    const cache = new ReplayCache(WEBHOOK_TOLERANCE_MS);
    for (let i = 0; i < 1000; i++) cache.check(`sig-${i}`, NOW);
    expect(cache.size).toBe(1000);
    // Past 2x the tolerance window, every prior entry is expired and pruned.
    cache.check('later', NOW + 3 * WEBHOOK_TOLERANCE_MS);
    expect(cache.size).toBe(1);
  });

  it('re-admits a signature only once its retention window has fully passed', () => {
    const cache = new ReplayCache(WEBHOOK_TOLERANCE_MS);
    expect(cache.check('sig', NOW)).toBe(true);
    expect(cache.check('sig', NOW + WEBHOOK_TOLERANCE_MS)).toBe(false); // still retained
    expect(cache.check('sig', NOW + 3 * WEBHOOK_TOLERANCE_MS)).toBe(true); // pruned → new
  });
});
