/**
 * 311 hand-off delivery receipts + reconciliation/retry (R3).
 *
 * The research roadmap's P0 finding (EV-ABANDON): civic tools die when a
 * forwarded report vanishes silently. This module makes every forward attempt
 * leave a receipt (`HandoffDelivery` on the stored hazard), schedules
 * exponential retries for failed attempts, and parks exhausted ones in a
 * `failed` dead-letter state a moderator can see and manually re-send.
 *
 * Like the adapters it drives (gogov.ts / open311.ts), everything here
 * DEGRADES GRACEFULLY and is fully exercisable in dry-run — no provider
 * credentials are needed to test the receipt/retry logic itself. Actual
 * delivery to the city still requires a real provider contract (⛔ external).
 */
import { forwardHandoff, type HandoffForwardOutcome, type HandoffProviderConfig } from './handoff.ts';
import { initialHandoff } from './lifecycle.ts';
import type { Repository } from './repository.ts';
import type { HandoffDelivery, StoredHazard } from './types.ts';

/** First retry delay after a failed forward. */
export const RETRY_BASE_MS = 5 * 60 * 1000;
/** Retry delays double per failed attempt, capped here. */
export const RETRY_MAX_DELAY_MS = 6 * 60 * 60 * 1000;
/** Forward attempts (initial + automatic retries) before dead-lettering. */
export const MAX_ATTEMPTS = 6;

/** Exponential backoff: 5 min → 10 → 20 → … capped at 6 h. */
export function retryDelayMs(attempts: number): number {
  const exp = RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1);
  return Math.min(exp, RETRY_MAX_DELAY_MS);
}

/**
 * The receipt a forward outcome implies.
 *
 * - dry-run: recorded intent only (`submitted` + `dryRun: true`) — nothing to
 *   retry, no transport ran.
 * - delivered: `submitted`, awaiting the city's sync-back (which flips the
 *   receipt to `acked` — see lifecycle.ts).
 * - failed: `retrying` with the next attempt scheduled, until the attempt
 *   budget is spent — then `failed` (dead letter).
 */
export function receiptFor(
  outcome: Pick<HandoffForwardOutcome, 'delivered' | 'dryRun' | 'error'>,
  previous: HandoffDelivery | null | undefined,
  now: number,
): HandoffDelivery {
  const attempts = (previous?.attempts ?? 0) + 1;
  if (outcome.dryRun || outcome.delivered) {
    return {
      state: 'submitted',
      dryRun: outcome.dryRun,
      attempts,
      lastAttemptAt: now,
      nextRetryAt: null,
      lastError: null,
    };
  }
  const exhausted = attempts >= MAX_ATTEMPTS;
  return {
    state: exhausted ? 'failed' : 'retrying',
    dryRun: false,
    attempts,
    lastAttemptAt: now,
    nextRetryAt: exhausted ? null : now + retryDelayMs(attempts),
    lastError: outcome.error ?? 'hand-off failed',
  };
}

export interface HandoffRetrySweepResult {
  /** Hazards whose retry was due and was attempted. */
  attempted: number;
  /** Attempts that went through (delivered, or dry-run after a config change). */
  recovered: number;
  /** Attempts that failed again and were re-scheduled. */
  rescheduled: number;
  /** Hazards that exhausted their retry budget and were dead-lettered. */
  deadLettered: number;
}

/**
 * Re-forward every hazard whose scheduled retry is due. Never throws; each
 * failed attempt invokes `onAttemptFailed` (metrics hook —
 * `dbhm_handoff_failures_total`).
 */
export async function sweepHandoffRetries(
  repo: Repository,
  config: HandoffProviderConfig,
  fetchImpl: typeof fetch,
  now: number,
  onAttemptFailed: () => void = () => {},
): Promise<HandoffRetrySweepResult> {
  const result: HandoffRetrySweepResult = {
    attempted: 0,
    recovered: 0,
    rescheduled: 0,
    deadLettered: 0,
  };
  for (const hazard of await repo.listHandoffRetryDue(now)) {
    result.attempted++;
    const updated = await retryHandoffOnce(repo, hazard, config, fetchImpl, now);
    const receipt = updated?.handoffDelivery;
    if (!receipt) continue;
    if (receipt.state === 'submitted') result.recovered++;
    else if (receipt.state === 'retrying') {
      result.rescheduled++;
      onAttemptFailed();
    } else if (receipt.state === 'failed') {
      result.deadLettered++;
      onAttemptFailed();
    }
  }
  return result;
}

/**
 * One forward attempt for one hazard, recording the receipt (and refreshing
 * the hand-off record on success so `reference`/`submittedAt` stay accurate).
 */
async function retryHandoffOnce(
  repo: Repository,
  hazard: StoredHazard,
  config: HandoffProviderConfig,
  fetchImpl: typeof fetch,
  now: number,
): Promise<StoredHazard | undefined> {
  const outcome = await forwardHandoff(hazard, config, fetchImpl);
  const receipt = receiptFor(outcome, hazard.handoffDelivery, now);
  const patch: Partial<StoredHazard> = { handoffDelivery: receipt, updatedAt: now };
  if (outcome.delivered) {
    // The successful attempt is the authoritative submission record.
    patch.handoff = initialHandoff(hazard, now, outcome.provider, outcome.reference);
  }
  return repo.update(hazard.id, patch);
}
