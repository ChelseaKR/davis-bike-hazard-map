/**
 * Typed wrapper around the hazard API.
 *
 * Keeps fetch details (base URL, error envelope, JSON parsing) in one place so
 * components and the sync loop stay declarative.
 */
import { getDeviceId } from './deviceId.ts';
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
import type { AreaCount } from '../../shared/areas.ts';

/**
 * Why a request failed, as a machine code rather than a sentence (issue #200,
 * the shape issue #173 established for `geolocation.ts` / `push.ts` /
 * `photo.ts`).
 *
 * `message` here is a DIAGNOSTIC: it is the server's own sentence when it sent
 * one, and the server composes it in English with no catalog behind it. It used
 * to be rendered verbatim to a rider — `useHazards` put it straight into
 * `ListView`'s `role="alert"` — so under an activated Spanish catalog the
 * wrapper was translated and the payload was not. Display code resolves `code`
 * through `feedErrorLabel()` in `src/i18n/labels.ts` instead, and the sentence
 * is kept only for diagnostics.
 */
export type ApiFailure = 'offline' | 'request' | 'server' | 'parse';

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: ApiFailure,
    readonly body?: ApiError,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ApiRequestError';
  }
}

/**
 * The failure code for an HTTP status. 5xx is the server; everything else that
 * reached the server and came back not-ok is the request. `status` is retained
 * on the error, so nothing here loses information.
 */
function failureFor(status: number): ApiFailure {
  return status >= 500 ? 'server' : 'request';
}

/**
 * Classify anything thrown out of this module for display.
 *
 * Lives here rather than in the hook because the mapping is a property of the
 * transport, and because a caller that reaches for `err.message` is the defect
 * this exists to remove — there is one place to look for the code.
 */
export function apiFailureOf(err: unknown): ApiFailure {
  return err instanceof ApiRequestError ? err.code : 'offline';
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${config.apiBase}${path}`, {
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
      ...init,
    });
  } catch (cause) {
    // `fetch` rejects only for a transport failure: offline, DNS, TLS, a
    // connection dropped mid-flight. There is no status and no server sentence,
    // and the browser's own text is vendor English in no catalog — so it is kept
    // as `cause` and never displayed, exactly as #173 did with
    // `GeolocationPositionError.message`.
    // i18n-exempt: a diagnostic message, never rendered; display resolves `code`
    throw new ApiRequestError('network request failed', 0, 'offline', undefined, { cause });
  }

  if (!res.ok) {
    let body: ApiError | undefined;
    try {
      body = (await res.json()) as ApiError;
    } catch {
      // non-JSON error body — ignore
    }
    throw new ApiRequestError(
      // The feed path renders `code` through `feedErrorLabel`, not this. The one
      // place this sentence still reaches a screen is `MyReports`, via the device
      // queue's `lastError` — a separate surface, tracked at issue #203.
      // i18n-exempt: a transport diagnostic; the display path resolves `code`
      body?.message ?? `Request failed (${res.status})`,
      res.status,
      failureFor(res.status),
      body,
    );
  }

  if (res.status === 204) return undefined as T;
  try {
    return (await res.json()) as T;
  } catch (cause) {
    // A 200 whose body is not the JSON this client expects. Reported as its own
    // code rather than as a transport failure: "the server answered and the
    // answer was unreadable" is a different thing to tell a rider than "you are
    // offline", and collapsing them is how a parse bug reads as a network blip.
    // i18n-exempt: a diagnostic message, never rendered; display resolves `code`
    throw new ApiRequestError('response body was not valid JSON', res.status, 'parse', undefined, {
      cause,
    });
  }
}

/** Optional delta-poll cursor layered on top of the display filters. */
export type HazardQuery = HazardFilters & { updatedSince?: number };

/** Build the public hazards query string from filters. */
export function buildHazardQuery(filters?: HazardQuery): string {
  if (!filters) return '';
  const params = new URLSearchParams();
  if (filters.categories?.length) params.set('categories', filters.categories.join(','));
  if (filters.minSeverity) params.set('minSeverity', filters.minSeverity);
  if (filters.withinDays) params.set('withinDays', String(filters.withinDays));
  if (filters.updatedSince !== undefined) params.set('updatedSince', String(filters.updatedSince));
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

/**
 * The public feed response. `deletedIds` and `serverTime` are present on delta
 * responses (a poll that passed `updatedSince`); a full feed omits `deletedIds`
 * (the client then treats it as a full refresh) and carries `serverTime` so the
 * client can seed its delta cursor.
 */
export interface HazardFeed {
  hazards: Hazard[];
  deletedIds?: string[];
  serverTime?: number;
}

/**
 * Fetch the public hazard feed. With no `updatedSince` this is the full feed;
 * with a cursor it returns only what changed since (plus id-only tombstones).
 */
export async function fetchHazards(filters?: HazardQuery): Promise<HazardFeed> {
  return request<HazardFeed>(`/hazards${buildHazardQuery(filters)}`);
}

/**
 * Fetch reports RECEIVED per Davis area, for the coverage view.
 *
 * A different set from `fetchHazards`, on purpose: the feed is what is on the
 * map now, this is what has ever been reported (minus rejected). The coverage
 * view calls an area a "data desert" when nobody has reported there, so it must
 * not be computed from the feed — reports sitting in the moderation queue, or
 * long since expired, would vanish and the area would read as never observed.
 */
export async function fetchCoverage(): Promise<AreaCount[]> {
  const { areas } = await request<{ areas: AreaCount[] }>('/coverage');
  return areas;
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

/**
 * Add an independent confirmation to an existing hazard.
 *
 * `counted` is false when this device already confirmed this hazard inside the
 * server's window (#177) — the request succeeded, and the count deliberately did
 * not move. Callers must distinguish that from a failure; treating it as one
 * would tell a rider their confirmation was lost when it had already landed.
 */
export async function confirmHazard(id: string): Promise<{ hazard: Hazard; counted: boolean }> {
  return request<{ hazard: Hazard; counted: boolean }>(/* i18n-exempt: URL path, not display copy */ `/hazards/${id}/confirm`, {
    method: 'POST',
    body: JSON.stringify({ deviceId: getDeviceId() }),
  });
}

/**
 * Plan a hazard-aware cycling route between two points. Same-origin (the server
 * proxies the OSRM backend), so the response is service-worker cacheable.
 */
export async function fetchRoute(from: GeoPoint, to: GeoPoint): Promise<RoutePlan> {
  // i18n-exempt: query string, not display copy
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
    headers: { authorization: /* i18n-exempt: RFC 9110 HTTP auth scheme token, not display copy */ `Bearer ${token}` },
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
    headers: { authorization: /* i18n-exempt: RFC 9110 HTTP auth scheme token, not display copy */ `Bearer ${token}` },
  });
  if (!res.ok) {
    // i18n-exempt: moderator-only diagnostic behind a login; never on a rider's screen
    throw new ApiRequestError(`Photo request failed (${res.status})`, res.status, failureFor(res.status));
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
    { headers: { authorization: /* i18n-exempt: RFC 9110 HTTP auth scheme token, not display copy */ `Bearer ${token}` } },
  );
  return failures;
}

/**
 * Moderation: re-send a hazard to 311 (same route as the initial hand-off —
 * the server records a fresh delivery receipt for the attempt).
 */
export async function retryHandoff(id: string, token: string): Promise<void> {
  await request<unknown>(/* i18n-exempt: URL path, not display copy */ `/moderation/${id}/handoff`, {
    method: 'POST',
    headers: { authorization: /* i18n-exempt: RFC 9110 HTTP auth scheme token, not display copy */ `Bearer ${token}` },
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
    headers: { authorization: /* i18n-exempt: RFC 9110 HTTP auth scheme token, not display copy */ `Bearer ${token}` },
    body: JSON.stringify({ decision, reason }),
  });
}

/** Result of an OSM Note suggestion (dry-run by default). */
export interface OsmNoteResult {
  delivered: boolean;
  dryRun: boolean;
  payload: { lat: number; lon: number; text: string };
  status?: number;
  error?: string;
}

/**
 * Moderation: draft (dry-run by default) an OSM Note for a permanent-infrastructure
 * hazard. Only eligible categories are accepted server-side (400 otherwise).
 */
export async function suggestOsmNote(
  id: string,
  token: string,
): Promise<{ result: OsmNoteResult; hazard: Hazard }> {
  return request<{ result: OsmNoteResult; hazard: Hazard }>(/* i18n-exempt: URL path, not display copy */ `/moderation/${id}/osm-note`, {
    method: 'POST',
    headers: { authorization: /* i18n-exempt: RFC 9110 HTTP auth scheme token, not display copy */ `Bearer ${token}` },
    body: JSON.stringify({}),
  });
}
