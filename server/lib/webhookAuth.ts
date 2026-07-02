/**
 * Inbound 311/GOGov webhook authentication (FIX-02).
 *
 * The webhook is the ingress for the product's highest-trust claim ("the city
 * marked it fixed"), so its authentication must be its best-defended surface.
 * Rather than comparing a header to a raw static secret (which any observer of
 * one request could then forge forever), we require the sender to prove three
 * things on every call:
 *
 *   1. Possession of the shared secret, via an HMAC-SHA256 over the EXACT bytes
 *      of the request body — so the signature is cryptographically bound to the
 *      payload and can't be lifted onto a forged body.
 *   2. Freshness, via a signed timestamp inside the HMAC and a tolerance window
 *      — an old capture is rejected even if the signature was once valid.
 *   3. Uniqueness, via a replay cache (see `ReplayCache`) that remembers recent
 *      signatures for the length of the tolerance window, so a captured request
 *      can't be re-delivered inside its own freshness window.
 *
 * Pure and dependency-free (just node:crypto) so it is trivially unit-testable.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/** Default freshness window for the signed timestamp: 5 minutes each way. */
export const WEBHOOK_TOLERANCE_MS = 5 * 60 * 1000;

/** Why a webhook verification failed (for logging; never sent to the caller). */
export type WebhookRejectReason =
  | 'missing_signature'
  | 'missing_timestamp'
  | 'bad_timestamp'
  | 'stale'
  | 'bad_signature';

export type WebhookVerifyResult =
  | { ok: true; signature: string }
  | { ok: false; reason: WebhookRejectReason };

export interface WebhookVerifyInput {
  /** The configured shared secret (`GOGOV_WEBHOOK_SECRET`). */
  secret: string;
  /** Value of the `x-gogov-signature` header (hex HMAC), if present. */
  signatureHeader: string | undefined;
  /** Value of the `x-gogov-timestamp` header (epoch ms), if present. */
  timestampHeader: string | undefined;
  /** The RAW request body, exactly as received (what the sender signed). */
  rawBody: string;
  /** Current time (epoch ms). */
  now: number;
  /** Freshness window; defaults to {@link WEBHOOK_TOLERANCE_MS}. */
  toleranceMs?: number;
}

/**
 * Compute the expected signature for a body at a given timestamp. The timestamp
 * is folded into the signed message so it can't be tampered with independently
 * of the signature. Exported so a GOGov shim (and the tests) can sign correctly.
 */
export function signWebhookBody(secret: string, timestamp: number, rawBody: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}

/** Constant-time compare of two hex strings; false (not throw) on length mismatch. */
function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Verify an inbound webhook's signature + freshness. Does NOT touch replay
 * state — the caller checks {@link ReplayCache} only once the signature is
 * known-good (so an attacker can't populate the cache with garbage). On success
 * the (verified) signature is returned to use as the replay key.
 */
export function verifyWebhook(input: WebhookVerifyInput): WebhookVerifyResult {
  const { secret, signatureHeader, timestampHeader, rawBody, now } = input;
  const toleranceMs = input.toleranceMs ?? WEBHOOK_TOLERANCE_MS;

  if (!signatureHeader) return { ok: false, reason: 'missing_signature' };
  if (!timestampHeader) return { ok: false, reason: 'missing_timestamp' };

  const ts = Number(timestampHeader);
  if (!Number.isFinite(ts)) return { ok: false, reason: 'bad_timestamp' };
  if (Math.abs(now - ts) > toleranceMs) return { ok: false, reason: 'stale' };

  const expected = signWebhookBody(secret, ts, rawBody);
  if (!safeEqualHex(signatureHeader, expected)) return { ok: false, reason: 'bad_signature' };

  return { ok: true, signature: expected };
}

/**
 * Bounded, self-pruning cache of recently-seen (verified) signatures for replay
 * protection. A signature is unique per (timestamp, body, secret), so a replay
 * necessarily re-presents an already-seen one. Entries are retained for twice
 * the tolerance window — long enough that no replay can still pass the freshness
 * check — then pruned, so the cache stays bounded even under a spray of traffic.
 */
export class ReplayCache {
  private readonly seen = new Map<string, number>();
  private readonly ttlMs: number;

  constructor(toleranceMs: number = WEBHOOK_TOLERANCE_MS) {
    // Retain past the far edge of the freshness window (see class doc).
    this.ttlMs = 2 * toleranceMs;
  }

  /**
   * Record a signature as seen. Returns true if it is NEW (accept the request),
   * false if it was already seen within the retention window (a replay — reject).
   */
  check(signature: string, now: number): boolean {
    this.prune(now);
    if (this.seen.has(signature)) return false;
    this.seen.set(signature, now + this.ttlMs);
    return true;
  }

  /** Current number of retained entries (for tests/observability). */
  get size(): number {
    return this.seen.size;
  }

  private prune(now: number): void {
    for (const [sig, expiresAt] of this.seen) {
      if (expiresAt <= now) this.seen.delete(sig);
    }
  }
}
