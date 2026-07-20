/**
 * Server-internal record types. The key distinction from the public `Hazard`:
 * we keep the PRECISE location (needed only for an opt-in 311 hand-off) and the
 * photo bytes server-side, and never expose either in the public feed.
 */
import type {
  GeoPoint,
  HandoffInfo,
  HazardCategory,
  HazardStatus,
  Severity,
} from '../../shared/types.ts';

export interface ModerationAction {
  decision: 'approve' | 'reject' | 'resolve';
  reason?: string;
  at: number;
  /** Username of the moderator who took the action (audit trail). */
  by?: string;
}

/**
 * Reference to a photo whose bytes live in the PhotoStore (keyed by hazard id),
 * NOT inline in this record. Only the mime is kept here so the record stays
 * small and the JSON file doesn't carry base64.
 */
export interface PhotoRef {
  mime: string;
}

/**
 * Delivery receipt for a 311 hand-off (R3): the server-side record of every
 * forward attempt, so a hand-off can never vanish silently. SERVER-INTERNAL —
 * `lastError` may carry provider internals, so this never appears in the
 * public `Hazard` projection; the moderator dead-letter route is the only
 * surface that returns it (auth-gated).
 *
 * States: `submitted` (forwarded; `dryRun` tells whether a real transport ran)
 * → `acked` (the city's status sync-back proved receipt) · `retrying`
 * (transport/provider failure, next attempt scheduled) → `failed` (retry
 * budget exhausted — the dead-letter state a moderator must act on).
 */
export interface HandoffDelivery {
  state: 'submitted' | 'acked' | 'retrying' | 'failed';
  /** True when no real transport is configured (recorded intent only). */
  dryRun: boolean;
  /** Total forward attempts made (manual re-sends keep counting up). */
  attempts: number;
  /** Epoch ms of the most recent attempt. */
  lastAttemptAt: number;
  /** Epoch ms the next automatic retry is due, or null when none is scheduled. */
  nextRetryAt: number | null;
  /** Last transport/provider error, or null after a successful attempt. */
  lastError: string | null;
}

export interface StoredHazard {
  id: string;
  clientId: string;
  category: HazardCategory;
  severity: Severity;
  description: string | null;
  /** Exact device location — internal only. */
  preciseLocation: GeoPoint;
  /** Grid-snapped location safe for public display. */
  publicLocation: GeoPoint;
  /** Reference to the EXIF-stripped photo in the PhotoStore, or null. */
  photo: PhotoRef | null;
  status: HazardStatus;
  confirmations: number;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  /** Epoch ms the hazard was resolved (fixed), or null/undefined. */
  resolvedAt?: number | null;
  /** 311 hand-off record + synced-back status, or null/undefined. */
  handoff?: HandoffInfo | null;
  /** Delivery receipt for the hand-off (R3), or null/undefined. Server-internal. */
  handoffDelivery?: HandoffDelivery | null;
  moderation: ModerationAction[];
}
