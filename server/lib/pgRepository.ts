/**
 * Production store: PostgreSQL.
 *
 * Plain Postgres columns + btree indexes are enough for everything this app
 * does — including the bounding-box cull of the public feed (lat/lng BETWEEN).
 * PostGIS would only be needed for richer geometry (radius, polygons); it is a
 * deliberate non-dependency here and can be layered on later without changing
 * this interface.
 *
 * Concurrency: unlike the JSON store, Postgres is safe for multiple processes.
 * Partial updates use a transactional read-modify-write (SELECT ... FOR UPDATE)
 * so concurrent confirms/moderations don't clobber each other.
 */
import { Pool, type PoolClient } from 'pg';
import type { StoredHazard, ModerationAction, PhotoRef, HandoffDelivery } from './types.ts';
import type { HandoffInfo } from '../../shared/types.ts';
import {
  decodePendingCursor,
  encodePendingCursor,
  type BBox,
  type PendingPage,
  type PendingPageOptions,
  type PendingStats,
  type Repository,
} from './repository.ts';
import { runMigrations } from './migrate.ts';

interface HazardRow {
  id: string;
  client_id: string;
  category: string;
  severity: string;
  description: string | null;
  precise_lat: number;
  precise_lng: number;
  public_lat: number;
  public_lng: number;
  photo_mime: string | null;
  status: string;
  confirmations: number;
  created_at: string; // bigint comes back as string from pg
  updated_at: string;
  expires_at: string;
  resolved_at: string | null;
  handoff: HandoffInfo | null;
  handoff_delivery: HandoffDelivery | null;
  moderation: ModerationAction[];
}

function rowToHazard(r: HazardRow): StoredHazard {
  const photo: PhotoRef | null = r.photo_mime ? { mime: r.photo_mime } : null;
  return {
    id: r.id,
    clientId: r.client_id,
    category: r.category as StoredHazard['category'],
    severity: r.severity as StoredHazard['severity'],
    description: r.description,
    preciseLocation: { lat: r.precise_lat, lng: r.precise_lng },
    publicLocation: { lat: r.public_lat, lng: r.public_lng },
    photo,
    status: r.status as StoredHazard['status'],
    confirmations: r.confirmations,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
    expiresAt: Number(r.expires_at),
    resolvedAt: r.resolved_at != null ? Number(r.resolved_at) : null,
    handoff: r.handoff ?? null,
    handoffDelivery: r.handoff_delivery ?? null,
    moderation: r.moderation ?? [],
  };
}

const COLUMNS = `
  id, client_id, category, severity, description,
  precise_lat, precise_lng, public_lat, public_lng, photo_mime,
  status, confirmations, created_at, updated_at, expires_at,
  resolved_at, handoff, handoff_delivery, moderation`;

/** Positional parameter values for INSERT/UPDATE, in COLUMNS order (minus id). */
function writeValues(h: StoredHazard): unknown[] {
  return [
    h.id,
    h.clientId,
    h.category,
    h.severity,
    h.description,
    h.preciseLocation.lat,
    h.preciseLocation.lng,
    h.publicLocation.lat,
    h.publicLocation.lng,
    h.photo?.mime ?? null,
    h.status,
    h.confirmations,
    h.createdAt,
    h.updatedAt,
    h.expiresAt,
    h.resolvedAt ?? null,
    h.handoff ? JSON.stringify(h.handoff) : null,
    h.handoffDelivery ? JSON.stringify(h.handoffDelivery) : null,
    JSON.stringify(h.moderation),
  ];
}

export class PostgresRepository implements Repository {
  private pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString });
  }

  /** Apply pending migrations (idempotent). Safe to run on every boot. */
  async init(): Promise<void> {
    await runMigrations(this.pool);
  }

  async insert(hazard: StoredHazard): Promise<StoredHazard> {
    await this.pool.query(
      `INSERT INTO hazards (${COLUMNS})
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
      writeValues(hazard),
    );
    return hazard;
  }

  async findById(id: string): Promise<StoredHazard | undefined> {
    const res = await this.pool.query<HazardRow>(
      `SELECT ${COLUMNS} FROM hazards WHERE id = $1`,
      [id],
    );
    return res.rows[0] ? rowToHazard(res.rows[0]) : undefined;
  }

  async findByClientId(clientId: string): Promise<StoredHazard | undefined> {
    const res = await this.pool.query<HazardRow>(
      `SELECT ${COLUMNS} FROM hazards WHERE client_id = $1`,
      [clientId],
    );
    return res.rows[0] ? rowToHazard(res.rows[0]) : undefined;
  }

  async update(id: string, patch: Partial<StoredHazard>): Promise<StoredHazard | undefined> {
    return this.withTxn(async (client) => {
      const res = await client.query<HazardRow>(
        `SELECT ${COLUMNS} FROM hazards WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (!res.rows[0]) return undefined;
      const merged: StoredHazard = { ...rowToHazard(res.rows[0]), ...patch, id };
      await client.query(
        `UPDATE hazards SET
           client_id=$2, category=$3, severity=$4, description=$5,
           precise_lat=$6, precise_lng=$7, public_lat=$8, public_lng=$9,
           photo_mime=$10, status=$11, confirmations=$12,
           created_at=$13, updated_at=$14, expires_at=$15,
           resolved_at=$16, handoff=$17, handoff_delivery=$18, moderation=$19
         WHERE id=$1`,
        writeValues(merged),
      );
      return merged;
    });
  }

  async all(): Promise<StoredHazard[]> {
    const res = await this.pool.query<HazardRow>(`SELECT ${COLUMNS} FROM hazards`);
    return res.rows.map(rowToHazard);
  }

  async listActive(now: number, bbox?: BBox): Promise<StoredHazard[]> {
    const params: unknown[] = [now];
    let where = `status = 'approved' AND expires_at > $1`;
    if (bbox) {
      params.push(bbox.minLat, bbox.maxLat, bbox.minLng, bbox.maxLng);
      where += ` AND public_lat BETWEEN $2 AND $3 AND public_lng BETWEEN $4 AND $5`;
    }
    const res = await this.pool.query<HazardRow>(
      `SELECT ${COLUMNS} FROM hazards WHERE ${where} ORDER BY updated_at DESC`,
      params,
    );
    return res.rows.map(rowToHazard);
  }

  async listRecentlyResolved(resolvedAfter: number, bbox?: BBox): Promise<StoredHazard[]> {
    const params: unknown[] = [resolvedAfter];
    let where = `status = 'resolved' AND resolved_at IS NOT NULL AND resolved_at >= $1`;
    if (bbox) {
      params.push(bbox.minLat, bbox.maxLat, bbox.minLng, bbox.maxLng);
      where += ` AND public_lat BETWEEN $2 AND $3 AND public_lng BETWEEN $4 AND $5`;
    }
    const res = await this.pool.query<HazardRow>(
      `SELECT ${COLUMNS} FROM hazards WHERE ${where} ORDER BY resolved_at DESC`,
      params,
    );
    return res.rows.map(rowToHazard);
  }

  async listPending(opts: PendingPageOptions): Promise<PendingPage> {
    // Keyset pagination on (created_at, id): stable under concurrent inserts
    // and O(page) regardless of queue depth (FIX-04). COLLATE "C" pins the id
    // tiebreak to byte order, matching the in-memory store's code-unit compare.
    const after = opts.cursor ? decodePendingCursor(opts.cursor) : null;
    const params: unknown[] = [];
    let where = `status = 'pending'`;
    if (after) {
      params.push(after.createdAt, after.id);
      where += ` AND (created_at, id COLLATE "C") > ($1, $2)`;
    }
    params.push(opts.limit + 1); // one extra row detects whether more remain
    const res = await this.pool.query<HazardRow>(
      `SELECT ${COLUMNS} FROM hazards WHERE ${where}
       ORDER BY created_at, id COLLATE "C" LIMIT $${params.length}`,
      params,
    );
    const rows = res.rows.map(rowToHazard);
    const page = rows.slice(0, opts.limit);
    const last = page.at(-1);
    const nextCursor = rows.length > page.length && last ? encodePendingCursor(last) : null;
    return { hazards: page, nextCursor };
  }

  async expire(now: number): Promise<number> {
    // WHERE status='approved' mirrors the state machine's single `expire` edge
    // (approved → expired, shared/statusMachine.ts); terminal states are never
    // touched. Keep the predicate in lockstep with LEGAL_TRANSITIONS.
    const res = await this.pool.query(
      `UPDATE hazards
         SET status='expired', updated_at=$1,
             precise_lat=public_lat, precise_lng=public_lng
       WHERE status='approved' AND expires_at <= $1`,
      [now],
    );
    return res.rowCount ?? 0;
  }

  async listPhotoGcCandidates(cutoff: number): Promise<StoredHazard[]> {
    const res = await this.pool.query<HazardRow>(
      `SELECT ${COLUMNS} FROM hazards
       WHERE photo_mime IS NOT NULL
         AND status IN ('expired', 'resolved')
         AND COALESCE(resolved_at, updated_at) <= $1`,
      [cutoff],
    );
    return res.rows.map(rowToHazard);
  }

  async listHandoffRetryDue(now: number): Promise<StoredHazard[]> {
    const res = await this.pool.query<HazardRow>(
      `SELECT ${COLUMNS} FROM hazards
       WHERE handoff_delivery->>'state' = 'retrying'
         AND (handoff_delivery->>'nextRetryAt')::bigint <= $1`,
      [now],
    );
    return res.rows.map(rowToHazard);
  }

  async listHandoffFailed(): Promise<StoredHazard[]> {
    const res = await this.pool.query<HazardRow>(
      `SELECT ${COLUMNS} FROM hazards
       WHERE handoff_delivery->>'state' = 'failed'
       ORDER BY (handoff_delivery->>'lastAttemptAt')::bigint`,
    );
    return res.rows.map(rowToHazard);
  }

  async deleteById(id: string): Promise<boolean> {
    const res = await this.pool.query('DELETE FROM hazards WHERE id = $1', [id]);
    return (res.rowCount ?? 0) > 0;
  }

  async pendingStats(): Promise<PendingStats> {
    const res = await this.pool.query<{ count: string; oldest: string | null }>(
      `SELECT COUNT(*)::text AS count, MIN(created_at)::text AS oldest
       FROM hazards WHERE status = 'pending'`,
    );
    const row = res.rows[0];
    return {
      count: Number(row?.count ?? 0),
      oldestCreatedAt: row?.oldest != null ? Number(row.oldest) : null,
    };
  }

  async ping(): Promise<boolean> {
    const res = await this.pool.query('SELECT 1 AS ok');
    return res.rows[0]?.ok === 1;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private async withTxn<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}
