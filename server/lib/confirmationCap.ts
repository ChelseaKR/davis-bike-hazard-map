/**
 * Per-device confirmation cap (#177, third bullet).
 *
 * ## The hole this closes
 *
 * `confirmHazard` documented itself as recording "an independent confirmation"
 * and nothing made it independent. The endpoint took no body, read no cookie or
 * header, and carried no per-route limiter — only the global 120-requests-per-60s
 * per-IP bucket shared with every other call. So one rider tapping "I saw this
 * too" ten times published `10 confirmations`, and because each confirmation also
 * pushes `expiresAt` out by a full severity TTL, the same ten taps could hold a
 * hazard on the map indefinitely.
 *
 * Both of those are read by people as facts about the world. The map popup says
 * "N confirmations", the report trail says "confirmed N×", and the duplicate
 * nudge tells a rider that confirming "strengthens the one report the city sees".
 * Ten taps from one phone is not ten riders, and rendering it as ten is this
 * portfolio's dominant defect: an absence — of any check that these were separate
 * people — published as a measurement.
 *
 * ## What this is, precisely
 *
 * A **cap within a rotating window**, which is what #177 asks for ("ten
 * confirmations from one device inside the window count once"). The first
 * confirmation of a hazard from a device counts; further ones inside the window
 * are accepted and acknowledged but do not increment the count and do not extend
 * the hazard's life.
 *
 * ## What this is NOT — read this before describing it to anyone
 *
 * It is **not** anti-abuse, and it must never be described as such. The device id
 * is supplied by the client, so anything that can rotate a UUID defeats it
 * completely. It stops accidental double-taps, an offline queue replaying, and a
 * rider who genuinely forgot they already confirmed — the honest majority of
 * inflation. A determined actor is #177's burst-detection work, which is not this.
 *
 * ## Privacy
 *
 * The raw device id is never stored and never leaves this module. What is kept is
 * `HMAC-SHA256(secret ‖ epoch, deviceId ‖ hazardId)`, truncated — an opaque token
 * scoped to one (device, hazard, time-window) triple. Three consequences, all
 * deliberate:
 *
 * - The table of tokens cannot be walked to ask "what has this device seen?"
 *   without already holding the device id. A confirmation ledger keyed on a raw
 *   device id would be a movement trace of a cyclist, which is the exact category
 *   of data this project fuzzes locations to avoid creating (#160).
 * - The key is bound to the hazard, so two tokens from one device are not
 *   linkable to each other.
 * - The epoch rotates the secret input, so tokens expire by construction rather
 *   than by anyone remembering to delete them (FIX-10 minimisation).
 *
 * Nothing here is persisted. The state is per-process and in-memory, exactly like
 * `LoginThrottle` — and with the same caveat, which is real and is stated in the
 * runbook rather than hidden: **restarting the server, or running more than one
 * instance, resets the window.** A cap that survived a restart would mean a
 * durable per-device record, and that trade was decided the other way here.
 */

import { createHmac, randomBytes } from 'node:crypto';

/**
 * How long one device's confirmation of one hazard is remembered. Also the
 * rotation period of the key material.
 *
 * Twelve hours, not the hazard TTL. A hazard that is still there tomorrow is
 * genuinely worth re-confirming — that is the signal `expiresAt` extension exists
 * to carry — so the window is a "you just did this" guard, not a permanent
 * one-vote-per-device rule. Making it permanent would need a durable ledger, and
 * see the privacy note above.
 */
export const CONFIRMATION_WINDOW_MS = 12 * 60 * 60 * 1000;

/** Hard cap on distinct (device, hazard) tokens tracked at once. */
export const MAX_TRACKED_CONFIRMATIONS = 50_000;

/** Bytes of HMAC output kept. 16 bytes = 128 bits; collisions are not a concern. */
const KEY_BYTES = 16;

/**
 * Derive the rotating, salted device key for one (device, hazard) pair.
 *
 * The epoch is folded into the HMAC *key*, not the message, so two windows
 * produce unrelated tokens rather than related ones. Length-prefixing the device
 * id keeps the message unambiguous: without it, ('ab','c') and ('a','bc') would
 * hash identically, and two different devices could silently share a token.
 */
export function deviceKey(
  secret: string,
  deviceId: string,
  hazardId: string,
  now: number,
  windowMs: number = CONFIRMATION_WINDOW_MS,
): string {
  const epoch = Math.floor(now / windowMs);
  return createHmac('sha256', `${secret}:${epoch}`)
    .update(`${deviceId.length}:${deviceId}:${hazardId}`)
    .digest('hex')
    .slice(0, KEY_BYTES * 2);
}

interface Seen {
  /** Epoch ms this token was first recorded — drives staleness and LRU order. */
  at: number;
}

/**
 * Remembers which (device, hazard) pairs have already been counted, bounded and
 * self-pruning. Same insertion-ordered-Map-as-LRU shape as `LoginThrottle`: every
 * write re-inserts, so iteration is oldest-first and both the lazy expiry and the
 * opportunistic sweep are cheap.
 */
export class ConfirmationCap {
  /** token -> entry; insertion order == recency order. */
  private readonly seen = new Map<string, Seen>();
  private readonly secret: string;
  private readonly windowMs: number;
  private readonly maxEntries: number;

  constructor(opts: { secret?: string; windowMs?: number; maxEntries?: number } = {}) {
    // A random per-process secret is the right default, not a placeholder: the
    // key must not be guessable, and nothing outside this process ever needs to
    // reproduce it. An empty configured secret falls back here rather than
    // silently deriving every token from '' — which would make tokens
    // reproducible by anyone who read this file.
    this.secret = opts.secret || randomBytes(32).toString('hex');
    this.windowMs = opts.windowMs ?? CONFIRMATION_WINDOW_MS;
    this.maxEntries = opts.maxEntries ?? MAX_TRACKED_CONFIRMATIONS;
  }

  /**
   * Claim one confirmation. Returns true when it should count.
   *
   * Records the claim as a side effect, so a caller cannot check-then-forget:
   * the two-step version invites a race where two concurrent requests both see
   * "not seen" and both increment.
   */
  claim(deviceId: string, hazardId: string, now: number): boolean {
    this.prune(now);
    // BOTH the current epoch's token and the previous one. The epoch is an
    // absolute bucket, not a per-device offset, so a device that first confirmed
    // late in a bucket rolls into the next one long before its own window is up.
    // Checking only the current epoch made the real suppression window anything
    // from twelve hours down to a millisecond, depending on nothing but when the
    // first tap happened to land — a cap that silently barely applied. Caught by
    // `the same device counts again once the window has fully elapsed`, which
    // only fails because its base instant sits mid-bucket.
    const current = deviceKey(this.secret, deviceId, hazardId, now, this.windowMs);
    const previous = deviceKey(this.secret, deviceId, hazardId, now - this.windowMs, this.windowMs);
    for (const token of previous === current ? [current] : [current, previous]) {
      const existing = this.seen.get(token);
      if (existing && !this.isStale(existing, now)) {
        // Deliberately NOT re-inserted. Refreshing `at` on a suppressed claim
        // would let a device tapping every few minutes hold its own entry alive
        // forever and never be able to confirm again.
        return false;
      }
      // Stale, or under a token that has now rotated away: drop it.
      this.seen.delete(token);
    }
    this.seen.set(current, { at: now });
    // Hard cap: a spray of fresh device ids must not grow process memory without
    // bound. Evicting the oldest can let an evicted device confirm again, which
    // is the acceptable direction to fail — the alternative is refusing genuine
    // confirmations from real riders because someone flooded the map.
    while (this.seen.size > this.maxEntries) {
      const oldest = this.seen.keys().next().value;
      if (oldest === undefined) break;
      this.seen.delete(oldest);
    }
    return true;
  }

  /** Number of tracked tokens (for tests/observability). */
  get size(): number {
    return this.seen.size;
  }

  private isStale(entry: Seen, now: number): boolean {
    return now - entry.at >= this.windowMs;
  }

  private prune(now: number): void {
    // Oldest-first, so stop at the first fresh entry.
    for (const [token, entry] of this.seen) {
      if (!this.isStale(entry, now)) break;
      this.seen.delete(token);
    }
  }
}
