/**
 * 311 hand-off provider selector (EXP-06).
 *
 * Dispatches between the bespoke GOGov adapter (`gogov.ts`) and the
 * vendor-neutral Open311 GeoReport v2 adapter (`open311.ts`) so the rest of
 * the app (`app.ts`'s hand-off routes) doesn't need to know which provider is
 * configured — "switching providers is config-only" (docs/ideation
 * 03-expansions.md, EXP-06). The provider used at hand-off time is recorded
 * on the hazard's `handoff.provider` and reused for every later status sync,
 * so an in-flight hand-off is unaffected by a later config change.
 */
import { forwardToGogov, fetchGogovStatus, type GogovConfig, type GogovResult } from './gogov.ts';
import {
  submitOpen311Request,
  fetchOpen311Status,
  type Open311Config,
  type Open311Result,
} from './open311.ts';
import type { StoredHazard } from './types.ts';

export interface HandoffProviderConfig {
  handoffProvider: 'gogov' | 'open311';
  gogov: GogovConfig;
  open311: Open311Config;
}

/**
 * The full underlying adapter result (unchanged shape — `payload` for gogov,
 * `request`/`serviceRequestId` for open311, so nothing observing the existing
 * GOGov contract breaks) plus the provider tag and the resolved reference to
 * store on the hazard for future status syncs.
 */
export type HandoffForwardOutcome =
  | ({ provider: 'gogov'; reference: string } & GogovResult)
  | ({ provider: 'open311'; reference: string } & Open311Result);

/** Forward a hazard to whichever provider is configured. Never throws. */
export async function forwardHandoff(
  hazard: StoredHazard,
  config: HandoffProviderConfig,
  fetchImpl: typeof fetch,
): Promise<HandoffForwardOutcome> {
  if (config.handoffProvider === 'open311') {
    const result = await submitOpen311Request(hazard, config.open311, fetchImpl);
    return {
      provider: 'open311',
      // No service_request_id yet in dry-run or on a failed submit — fall
      // back to the hazard id so the record is still addressable locally.
      reference: result.serviceRequestId ?? hazard.id,
      ...result,
    };
  }
  const result = await forwardToGogov(hazard, config.gogov, fetchImpl);
  return { provider: 'gogov', reference: hazard.id, ...result };
}

export interface HandoffStatusOutcome {
  dryRun: boolean;
  status?: string;
  note?: string;
  error?: string;
}

/**
 * Poll for the current status using the SAME provider the hazard was
 * originally handed off with (`hazard.handoff.provider`), never the
 * currently-configured one — a mid-flight provider switch must not orphan
 * in-progress hand-offs.
 */
export async function syncHandoffStatus(
  provider: string,
  reference: string,
  config: HandoffProviderConfig,
  fetchImpl: typeof fetch,
): Promise<HandoffStatusOutcome> {
  if (provider === 'open311') {
    return fetchOpen311Status(reference, config.open311, fetchImpl);
  }
  return fetchGogovStatus(reference, config.gogov, fetchImpl);
}
