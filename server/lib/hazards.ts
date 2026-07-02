/**
 * Hazard domain logic: intake (with privacy controls), moderation, the
 * confirm/resolve/expire lifecycle, and the public projection.
 *
 * Privacy controls applied at intake (Responsible-Tech audit C):
 *   - server-side EXIF strip as a backstop to the client strip;
 *   - location fuzzing so the public feed never carries a precise coordinate.
 */
import type { Hazard, Severity } from '../../shared/types.ts';
import { canTransition, transition, type TransitionCause } from '../../shared/statusMachine.ts';
import type { ValidatedReport } from '../../shared/validation.ts';
import { fuzzCoordinate } from '../../shared/geo.ts';
import { dataUrlToBytes, bytesToDataUrl } from '../../shared/exif.ts';
import { processPhoto } from './image.ts';
import { newId } from './id.ts';
import type { BBox, Repository } from './repository.ts';
import type { PhotoStore } from './photoStore.ts';
import type { ModerationAction, PhotoRef, StoredHazard } from './types.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

interface CreateOptions {
  ttlDays: Record<Severity, number>;
}

/** Storage key for a hazard's thumbnail blob (hyphen keeps the id path-safe). */
export function thumbKey(id: string): string {
  return `${id}-thumb`;
}

function expiryFor(severity: Severity, createdAt: number, ttlDays: Record<Severity, number>): number {
  return createdAt + ttlDays[severity] * DAY_MS;
}

/**
 * Create a hazard from a validated submission. Idempotent on `clientId`, so a
 * retried offline sync never produces duplicates.
 */
export async function createHazard(
  repo: Repository,
  photos: PhotoStore,
  report: ValidatedReport,
  now: number,
  opts: CreateOptions,
): Promise<StoredHazard> {
  const existing = await repo.findByClientId(report.clientId);
  if (existing) return existing;

  const id = newId();
  // Authoritative server-side re-encode (bounded, metadata-stripped) + thumb.
  const processed = report.photo ? await processPhoto(report.photo) : null;
  let photo: PhotoRef | null = null;
  if (processed) {
    await photos.put(id, processed.full);
    await photos.put(thumbKey(id), processed.thumb);
    photo = { mime: processed.mime };
  }

  const stored: StoredHazard = {
    id,
    clientId: report.clientId,
    category: report.category,
    severity: report.severity,
    description: report.description ?? null,
    preciseLocation: report.location,
    publicLocation: fuzzCoordinate(report.location),
    photo,
    status: 'pending',
    confirmations: 0,
    createdAt: now,
    updatedAt: now,
    expiresAt: expiryFor(report.severity, now, opts.ttlDays),
    moderation: [],
  };
  return repo.insert(stored);
}

/** The target status + transition cause each moderation decision implies. */
const MODERATION_TRANSITIONS: Record<
  ModerationAction['decision'],
  { to: 'approved' | 'rejected' | 'resolved'; cause: TransitionCause }
> = {
  approve: { to: 'approved', cause: 'moderate_approve' },
  reject: { to: 'rejected', cause: 'moderate_reject' },
  resolve: { to: 'resolved', cause: 'moderate_resolve' },
};

/**
 * Apply a moderation decision. Returns undefined if the hazard is unknown OR
 * the decision is illegal for its current status (per shared/statusMachine.ts)
 * — e.g. re-moderating a hazard already rejected, resolved, or expired.
 */
export async function moderateHazard(
  repo: Repository,
  id: string,
  decision: ModerationAction['decision'],
  now: number,
  reason?: string,
  by?: string,
): Promise<StoredHazard | undefined> {
  const hazard = await repo.findById(id);
  if (!hazard) return undefined;

  const { to, cause } = MODERATION_TRANSITIONS[decision];
  const statusPatch = transition(hazard, to, cause, now);
  if (!statusPatch) return undefined;

  const action: ModerationAction = { decision, reason, at: now, by };

  // Once a hazard reaches a terminal state, the precise location is no longer
  // needed (it was only for an optional 311 hand-off) — coarsen it to the
  // public grid so we don't retain a reporter's exact spot indefinitely.
  const coarsen = to !== 'approved';

  return repo.update(id, {
    ...statusPatch,
    moderation: [...hazard.moderation, action],
    ...(coarsen ? { preciseLocation: hazard.publicLocation } : {}),
  });
}

/**
 * Record an independent confirmation. Only approved, live hazards can be
 * confirmed; each confirmation also nudges the expiry out so actively-seen
 * hazards stay on the map.
 */
export async function confirmHazard(
  repo: Repository,
  id: string,
  now: number,
  opts: CreateOptions,
): Promise<StoredHazard | undefined> {
  const hazard = await repo.findById(id);
  // Confirming is a status-preserving self-edge; the table only permits it on
  // approved hazards (never pending or terminal ones).
  if (!hazard || !canTransition(hazard.status, hazard.status, 'confirm') || hazard.expiresAt <= now) {
    return undefined;
  }
  return repo.update(id, {
    confirmations: hazard.confirmations + 1,
    updatedAt: now,
    // Extend life by one severity-appropriate TTL from now.
    expiresAt: Math.max(hazard.expiresAt, expiryFor(hazard.severity, now, opts.ttlDays)),
  });
}

/**
 * Lazily expire approved hazards past their TTL. Called before reads so the
 * public feed is always self-cleaning even without a cron. Delegated to the
 * repository so Postgres can do it in a single UPDATE.
 */
export function sweepExpired(repo: Repository, now: number): Promise<number> {
  return repo.expire(now);
}

/** Project a stored hazard to the PUBLIC shape (fuzzed location, photo URL). */
export function toPublic(h: StoredHazard): Hazard {
  return {
    id: h.id,
    clientId: h.clientId,
    category: h.category,
    severity: h.severity,
    description: h.description,
    location: h.publicLocation,
    photoUrl: h.photo ? `/api/photos/${h.id}` : null,
    thumbnailUrl: h.photo ? `/api/photos/${h.id}?size=thumb` : null,
    status: h.status,
    confirmations: h.confirmations,
    createdAt: h.createdAt,
    updatedAt: h.updatedAt,
    expiresAt: h.expiresAt,
    resolvedAt: h.resolvedAt ?? null,
    handoff: h.handoff ?? null,
  };
}

/**
 * Project for the MODERATION queue. The moderator must SEE the photo to judge
 * it, so it is inlined here as a data URL (this response is auth-gated); it is
 * never exposed through the public photo route while the hazard is pending.
 */
export async function toModeration(h: StoredHazard, photos: PhotoStore): Promise<Hazard> {
  let photoUrl: string | null = null;
  if (h.photo) {
    const bytes = await photos.get(h.id);
    if (bytes) photoUrl = bytesToDataUrl(bytes, h.photo.mime);
  }
  return { ...toPublic(h), photoUrl };
}

/** The public feed: approved and not expired, optionally culled to a bbox. */
export async function listPublic(repo: Repository, now: number, bbox?: BBox): Promise<Hazard[]> {
  await repo.expire(now);
  const rows = await repo.listActive(now, bbox);
  return rows.map(toPublic);
}

/**
 * The public map/list feed: live (approved) hazards PLUS recently-resolved ones,
 * which stay visible for `resolvedVisibleMs` so cyclists can see a hazard was
 * fixed (the client renders them greyed via their `resolved` lifecycle stage).
 * Routing and the open-data export deliberately use the approved-only
 * `listPublic` instead — you don't route around, or publish, a fixed hazard.
 */
export async function listPublicFeed(
  repo: Repository,
  now: number,
  resolvedVisibleMs: number,
  bbox?: BBox,
): Promise<Hazard[]> {
  await repo.expire(now);
  const active = await repo.listActive(now, bbox);
  const resolved =
    resolvedVisibleMs > 0
      ? await repo.listRecentlyResolved(now - resolvedVisibleMs, bbox)
      : [];
  return [...active, ...resolved].map(toPublic);
}

/** The moderation queue: everything still pending review, oldest first. */
export async function listModerationQueue(
  repo: Repository,
  photos: PhotoStore,
): Promise<Hazard[]> {
  const rows = await repo.all();
  const pending = rows
    .filter((h) => h.status === 'pending')
    .sort((a, b) => a.createdAt - b.createdAt);
  return Promise.all(pending.map((h) => toModeration(h, photos)));
}

/**
 * One-time migration: older records stored the photo inline as a base64 data
 * URL string. Move any such bytes into the PhotoStore and replace the field
 * with a small { mime } reference. Safe to run on every startup (idempotent).
 */
export async function migrateInlinePhotos(repo: Repository, photos: PhotoStore): Promise<number> {
  let migrated = 0;
  for (const h of await repo.all()) {
    const legacy = (h as { photo: unknown }).photo;
    if (typeof legacy !== 'string') continue;
    try {
      const { bytes, mime } = dataUrlToBytes(legacy);
      await photos.put(h.id, bytes);
      await repo.update(h.id, { photo: { mime } });
      migrated++;
    } catch {
      // Unparseable legacy photo: drop the reference rather than keep junk.
      await repo.update(h.id, { photo: null });
    }
  }
  return migrated;
}
