/**
 * Hazard domain logic: intake (with privacy controls), moderation, the
 * confirm/resolve/expire lifecycle, and the public projection.
 *
 * Privacy controls applied at intake (Responsible-Tech audit C):
 *   - server-side EXIF strip as a backstop to the client strip;
 *   - location fuzzing so the public feed never carries a precise coordinate.
 */
import type { Hazard, Severity } from '../../shared/types.ts';
import type { ValidatedReport } from '../../shared/validation.ts';
import { fuzzCoordinate } from '../../shared/geo.ts';
import { dataUrlToBytes, bytesToDataUrl, stripExifBytes } from '../../shared/exif.ts';
import { newId } from './id.ts';
import type { Repository } from './repository.ts';
import type { ModerationAction, StoredHazard } from './types.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

interface CreateOptions {
  ttlDays: Record<Severity, number>;
}

/** Server-side EXIF backstop: re-strip JPEG bytes even though the client did. */
function sanitizePhoto(photo: string | null): string | null {
  if (!photo) return null;
  try {
    const { bytes, mime } = dataUrlToBytes(photo);
    if (mime !== 'image/jpeg') return photo;
    return bytesToDataUrl(stripExifBytes(bytes), mime);
  } catch {
    // Unparseable photo => drop it rather than store something suspect.
    return null;
  }
}

function expiryFor(severity: Severity, createdAt: number, ttlDays: Record<Severity, number>): number {
  return createdAt + ttlDays[severity] * DAY_MS;
}

/**
 * Create a hazard from a validated submission. Idempotent on `clientId`, so a
 * retried offline sync never produces duplicates.
 */
export function createHazard(
  repo: Repository,
  report: ValidatedReport,
  now: number,
  opts: CreateOptions,
): StoredHazard {
  const existing = repo.findByClientId(report.clientId);
  if (existing) return existing;

  const stored: StoredHazard = {
    id: newId(),
    clientId: report.clientId,
    category: report.category,
    severity: report.severity,
    description: report.description ?? null,
    preciseLocation: report.location,
    publicLocation: fuzzCoordinate(report.location),
    photo: sanitizePhoto(report.photo),
    status: 'pending',
    confirmations: 0,
    createdAt: now,
    updatedAt: now,
    expiresAt: expiryFor(report.severity, now, opts.ttlDays),
    moderation: [],
  };
  return repo.insert(stored);
}

/** Apply a moderation decision. Returns undefined if the hazard is unknown. */
export function moderateHazard(
  repo: Repository,
  id: string,
  decision: ModerationAction['decision'],
  now: number,
  reason?: string,
): StoredHazard | undefined {
  const hazard = repo.findById(id);
  if (!hazard) return undefined;

  const status =
    decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'resolved';
  const action: ModerationAction = { decision, reason, at: now };

  return repo.update(id, {
    status,
    updatedAt: now,
    moderation: [...hazard.moderation, action],
  });
}

/**
 * Record an independent confirmation. Only approved, live hazards can be
 * confirmed; each confirmation also nudges the expiry out so actively-seen
 * hazards stay on the map.
 */
export function confirmHazard(
  repo: Repository,
  id: string,
  now: number,
  opts: CreateOptions,
): StoredHazard | undefined {
  const hazard = repo.findById(id);
  if (!hazard || hazard.status !== 'approved' || hazard.expiresAt <= now) {
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
 * public feed is always self-cleaning even without a cron.
 */
export function sweepExpired(repo: Repository, now: number): number {
  let expired = 0;
  for (const h of repo.all()) {
    if (h.status === 'approved' && h.expiresAt <= now) {
      repo.update(h.id, { status: 'expired', updatedAt: now });
      expired++;
    }
  }
  return expired;
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
    status: h.status,
    confirmations: h.confirmations,
    createdAt: h.createdAt,
    updatedAt: h.updatedAt,
    expiresAt: h.expiresAt,
  };
}

/**
 * Project for the MODERATION queue. The moderator must SEE the photo to judge
 * it, so it is inlined here (this response is auth-gated); it is never exposed
 * through the public photo route while the hazard is still pending.
 */
export function toModeration(h: StoredHazard): Hazard {
  return { ...toPublic(h), photoUrl: h.photo };
}

/** The public feed: approved and not expired. */
export function listPublic(repo: Repository, now: number): Hazard[] {
  sweepExpired(repo, now);
  return repo
    .all()
    .filter((h) => h.status === 'approved' && h.expiresAt > now)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(toPublic);
}

/** The moderation queue: everything still pending review, oldest first. */
export function listModerationQueue(repo: Repository): Hazard[] {
  return repo
    .all()
    .filter((h) => h.status === 'pending')
    .sort((a, b) => a.createdAt - b.createdAt)
    .map(toModeration);
}
