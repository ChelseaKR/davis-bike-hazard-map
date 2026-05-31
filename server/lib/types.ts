/**
 * Server-internal record types. The key distinction from the public `Hazard`:
 * we keep the PRECISE location (needed only for an opt-in 311 hand-off) and the
 * photo bytes server-side, and never expose either in the public feed.
 */
import type {
  GeoPoint,
  HazardCategory,
  HazardStatus,
  Severity,
} from '../../shared/types.ts';

export interface ModerationAction {
  decision: 'approve' | 'reject' | 'resolve';
  reason?: string;
  at: number;
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
  /** EXIF-stripped photo as a data URL, or null. Internal only. */
  photo: string | null;
  status: HazardStatus;
  confirmations: number;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  moderation: ModerationAction[];
}
