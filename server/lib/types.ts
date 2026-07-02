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
 * Audit record of an OSM Note suggestion (EXP-08). Records WHO triggered it and
 * whether it was a dry-run draft or an actual post — the moderation audit trail
 * for the OSM feedback loop, mirroring how `handoff` records the 311 hand-off.
 */
export interface OsmNoteRecord {
  /** Username of the moderator who triggered the suggestion (audit trail). */
  by?: string;
  /** Epoch ms the suggestion was made. */
  at: number;
  /** True when it was only drafted (feature disabled), false when posted. */
  dryRun: boolean;
  /** True when a live post was accepted by OSM. */
  delivered: boolean;
}

/**
 * Reference to a photo whose bytes live in the PhotoStore (keyed by hazard id),
 * NOT inline in this record. Only the mime is kept here so the record stays
 * small and the JSON file doesn't carry base64.
 */
export interface PhotoRef {
  mime: string;
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
  /** OSM Note suggestion audit record (EXP-08), or null/undefined. */
  osmNote?: OsmNoteRecord | null;
  moderation: ModerationAction[];
}
