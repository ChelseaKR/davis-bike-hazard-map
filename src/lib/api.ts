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

  /**
   * The stable machine error code from the envelope (e.g. `validation_error`,
   * `outside_davis`, `not_found`). Undefined for non-JSON error bodies. Callers
   * should translate via this code (see src/i18n/apiErrors.ts) rather than
   * displaying `.message`, which is only an English fallback for API consumers.
   */
  get code(): string | undefined {
    return this.body?.error;
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
    // The Error `message` is a diagnostic string (used in logs/telemetry), NOT
    // for display — it carries the machine code, not the server's English prose.
    // UI surfaces translate via `err.code` (see src/i18n/apiErrors.ts).
    throw new ApiRequestError(
      body?.error ? `API error: ${body.error} (${res.status})` : `Request failed (${res.status})`,
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
  /** Preferred locale for push text; server validates + defaults to 'en'. */
  locale?: string,
): Promise<{ id: string }> {
  return request<{ id: string }>('/alerts/subscribe', {
    method: 'POST',
    body: JSON.stringify({ subscription, watch, label, locale }),
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

/** Moderation: fetch the queue of pending hazards (requires a session token). */
export async function fetchModerationQueue(token: string): Promise<Hazard[]> {
  const { hazards } = await request<{ hazards: Hazard[] }>('/moderation/queue', {
    headers: { authorization: `Bearer ${token}` },
  });
  return hazards;
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
