/**
 * Typed wrapper around the hazard API.
 *
 * Keeps fetch details (base URL, error envelope, JSON parsing) in one place so
 * components and the sync loop stay declarative.
 */
import { config } from '../config.ts';
import type {
  ApiError,
  GeoPoint,
  Hazard,
  HazardFilters,
  ReportSubmission,
} from '../../shared/types.ts';
import type { RoutePlan } from '../../shared/routing.ts';
import type { Watch } from '../../shared/alerts.ts';

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: ApiError,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${config.apiBase}${path}`, {
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });

  if (!res.ok) {
    let body: ApiError | undefined;
    try {
      body = (await res.json()) as ApiError;
    } catch {
      // non-JSON error body — ignore
    }
    throw new ApiRequestError(
      body?.message ?? `Request failed (${res.status})`,
      res.status,
      body,
    );
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Build the public hazards query string from filters. */
export function buildHazardQuery(filters?: HazardFilters): string {
  if (!filters) return '';
  const params = new URLSearchParams();
  if (filters.categories?.length) params.set('categories', filters.categories.join(','));
  if (filters.minSeverity) params.set('minSeverity', filters.minSeverity);
  if (filters.withinDays) params.set('withinDays', String(filters.withinDays));
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

/** Fetch the public (approved, unexpired) hazard list. */
export async function fetchHazards(filters?: HazardFilters): Promise<Hazard[]> {
  const { hazards } = await request<{ hazards: Hazard[] }>(
    `/hazards${buildHazardQuery(filters)}`,
  );
  return hazards;
}

/** Submit a report. Idempotent on `clientId`, so retries are safe. */
export async function submitReport(
  submission: ReportSubmission,
): Promise<{ hazard: Hazard }> {
  return request<{ hazard: Hazard }>('/reports', {
    method: 'POST',
    body: JSON.stringify(submission),
  });
}

/** Add an independent confirmation to an existing hazard. */
export async function confirmHazard(id: string): Promise<{ hazard: Hazard }> {
  return request<{ hazard: Hazard }>(`/hazards/${id}/confirm`, { method: 'POST' });
}

/**
 * Plan a hazard-aware cycling route between two points. Same-origin (the server
 * proxies the OSRM backend), so the response is service-worker cacheable.
 */
export async function fetchRoute(from: GeoPoint, to: GeoPoint): Promise<RoutePlan> {
  const q = `from=${from.lat},${from.lng}&to=${to.lat},${to.lng}`;
  const { plan } = await request<{ plan: RoutePlan }>(`/route?${q}`);
  return plan;
}

/**
 * Fetch the server-side status of your own report by its clientId (the
 * capability only your device holds), so "My reports" can show how it's
 * progressing — in review, on the map, handed to the city, fixed. Returns null
 * if the server has no record (e.g. it never synced, or you deleted it).
 */
export async function fetchReportStatus(clientId: string): Promise<Hazard | null> {
  try {
    const { hazard } = await request<{ hazard: Hazard }>(`/reports/${clientId}`);
    return hazard;
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 404) return null;
    throw err;
  }
}

/**
 * Delete your own report from the server by its clientId (the capability only
 * your device holds). Treats a 404 as already-gone. Best-effort.
 */
export async function deleteReport(clientId: string): Promise<void> {
  try {
    await request<void>(`/reports/${clientId}`, { method: 'DELETE' });
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 404) return;
    throw err;
  }
}

/** A browser PushSubscription's serialisable shape. */
export interface PushSubscriptionPayload {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** Register a saved-area/route push subscription. Returns the server-side id. */
export async function subscribeAlert(
  subscription: PushSubscriptionPayload,
  watch: Watch,
  label?: string,
): Promise<{ id: string }> {
  return request<{ id: string }>('/alerts/subscribe', {
    method: 'POST',
    body: JSON.stringify({ subscription, watch, label }),
  });
}

/** Remove a previously-registered alert subscription. Treats 404 as gone. */
export async function unsubscribeAlert(id: string): Promise<void> {
  try {
    await request<void>(`/alerts/subscribe/${id}`, { method: 'DELETE' });
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 404) return;
    throw err;
  }
}

export interface Session {
  token: string;
  username: string;
  expiresAt: number;
}

/** Moderator login. Returns a session token used as the bearer for moderation. */
export async function login(username: string, password: string): Promise<Session> {
  return request<Session>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}

/** One keyset page of the moderation queue (FIX-04). */
export interface ModerationQueuePage {
  hazards: Hazard[];
  /** Opaque cursor for the next page, or null on the last page. */
  nextCursor: string | null;
  /** Total reports awaiting moderation (not just this page). */
  total: number;
}

/**
 * Moderation: fetch one page of pending hazards (requires a session token).
 * Pass the previous page's `nextCursor` to continue the traversal.
 */
export async function fetchModerationQueue(
  token: string,
  cursor?: string,
): Promise<ModerationQueuePage> {
  const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  return request<ModerationQueuePage>(`/moderation/queue${qs}`, {
    headers: { authorization: `Bearer ${token}` },
  });
}

/**
 * Moderation: fetch a PENDING hazard's photo as an object URL. Pending photo
 * bytes are auth-gated (FIX-04), so a plain <img src> cannot carry the bearer
 * token — the bytes are fetched here and handed to the <img> as a blob URL.
 * Callers own the URL and must revoke it (URL.revokeObjectURL) when done.
 */
export async function fetchModerationPhoto(
  photoUrl: string,
  token: string,
): Promise<string> {
  const res = await fetch(photoUrl, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new ApiRequestError(`Photo request failed (${res.status})`, res.status);
  }
  return URL.createObjectURL(await res.blob());
}

/** A 311 hand-off delivery receipt (R3). Auth-gated, moderator-only data. */
export interface HandoffDeliveryReceipt {
  state: 'submitted' | 'acked' | 'retrying' | 'failed';
  dryRun: boolean;
  attempts: number;
  lastAttemptAt: number;
  nextRetryAt: number | null;
  lastError: string | null;
}

/** A dead-lettered hand-off: the hazard plus its delivery receipt. */
export interface HandoffFailure {
  hazard: Hazard;
  delivery: HandoffDeliveryReceipt | null;
}

/**
 * Moderation: hand-offs whose delivery exhausted the automatic retry budget
 * (R3 dead letters). Requires a moderator session token.
 */
export async function fetchHandoffFailures(token: string): Promise<HandoffFailure[]> {
  const { failures } = await request<{ failures: HandoffFailure[] }>(
    '/moderation/handoff-failures',
    { headers: { authorization: `Bearer ${token}` } },
  );
  return failures;
}

/**
 * Moderation: re-send a hazard to 311 (same route as the initial hand-off —
 * the server records a fresh delivery receipt for the attempt).
 */
export async function retryHandoff(id: string, token: string): Promise<void> {
  await request<unknown>(`/moderation/${id}/handoff`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
  });
}

/** Moderation: approve, reject, or resolve a hazard (requires a moderator token). */
export async function decideModeration(
  id: string,
  decision: 'approve' | 'reject' | 'resolve',
  token: string,
  reason?: string,
): Promise<{ hazard: Hazard }> {
  return request<{ hazard: Hazard }>(`/moderation/${id}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ decision, reason }),
  });
}
