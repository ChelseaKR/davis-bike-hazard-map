/**
 * Typed wrapper around the hazard API.
 *
 * Keeps fetch details (base URL, error envelope, JSON parsing) in one place so
 * components and the sync loop stay declarative.
 */
import { config } from '../config.ts';
import type {
  ApiError,
  Hazard,
  HazardFilters,
  ReportSubmission,
} from '../../shared/types.ts';

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

/** Moderation: fetch the queue of pending hazards (requires a moderator token). */
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
