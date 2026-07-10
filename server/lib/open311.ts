/**
 * Open311 GeoReport v2 hand-off adapter (EXP-06).
 *
 * The bespoke `gogov.ts` adapter talks to a proprietary, undocumented GOGov
 * contract. Open311 GeoReport v2 (http://www.open311.org/) is the vendor-
 * neutral civic standard many 311 systems expose. Implementing it against the
 * same `StoredHazard -> payload` seam gives Davis (and any future deployment)
 * a second, standards-based integration path that is testable *today* against
 * the public Open311 spec fixtures, without waiting on a city conversation.
 *
 * Like every other adapter in this codebase it DEGRADES GRACEFULLY: with no
 * endpoint configured it runs in dry-run and returns the payload/request it
 * would have sent, and it never throws.
 */
import type { StoredHazard } from './types.ts';
import { CATEGORY_LABELS, SEVERITY_LABELS } from '../../shared/types.ts';

export interface Open311Config {
  /** Base URL of the Open311 GeoReport v2 endpoint, e.g. https://311.example.gov/v2 */
  endpoint: string;
  /** API key (`api_key` form field), when the jurisdiction requires one. */
  apiKey?: string;
  /** `jurisdiction_id`, required by multi-jurisdiction Open311 servers. */
  jurisdictionId?: string;
  /** `service_code` this app's reports map onto (a single fixed service, per ROADMAP). */
  serviceCode: string;
}

/** The exact GeoReport v2 `POST /requests.{format}` form fields we send. Documented and minimal. */
export interface Open311Request {
  service_code: string;
  lat: number;
  long: number;
  description: string;
  jurisdiction_id?: string;
  api_key?: string;
  /** Free-form attribute the report's category/severity carries, per §5.4 of the spec. */
  attribute?: string[];
}

export interface Open311Result {
  delivered: boolean;
  dryRun: boolean;
  request: Open311Request;
  /** `service_request_id` returned by the server, when delivered. */
  serviceRequestId?: string;
  status?: number;
  error?: string;
}

/** Build the Open311 GeoReport v2 request body for a hazard. Pure, same seam as `gogov.ts#buildPayload`. */
export function buildOpen311Request(
  hazard: StoredHazard,
  config: Pick<Open311Config, 'serviceCode' | 'jurisdictionId' | 'apiKey'>,
): Open311Request {
  const description =
    hazard.description ??
    `${CATEGORY_LABELS[hazard.category]} reported by a cyclist.`;
  const request: Open311Request = {
    service_code: config.serviceCode,
    // Open311 requests dispatch a crew, so — like the GOGov adapter — this
    // uses the precise location (the reporter opted in by triggering hand-off).
    lat: hazard.preciseLocation.lat,
    long: hazard.preciseLocation.lng,
    description: `[${SEVERITY_LABELS[hazard.severity]}] ${description}`,
    attribute: [`category:${hazard.category}`, `reference:${hazard.id}`],
  };
  if (config.jurisdictionId) request.jurisdiction_id = config.jurisdictionId;
  if (config.apiKey) request.api_key = config.apiKey;
  return request;
}

/**
 * Submit a hazard as an Open311 `POST /requests.json`. With no endpoint
 * configured, returns a dry-run result describing the request. Never throws —
 * a failed hand-off must not break the app (graceful degradation, ROADMAP §6).
 */
export async function submitOpen311Request(
  hazard: StoredHazard,
  config: Open311Config,
  fetchImpl: typeof fetch = fetch,
): Promise<Open311Result> {
  const request = buildOpen311Request(hazard, config);

  if (!config.endpoint) {
    return { delivered: false, dryRun: true, request };
  }

  try {
    const body = new URLSearchParams();
    for (const [key, value] of Object.entries(request)) {
      if (value === undefined) continue;
      if (Array.isArray(value)) {
        for (const v of value) body.append(`${key}[]`, v);
      } else {
        body.append(key, String(value));
      }
    }
    const url = `${config.endpoint.replace(/\/$/, '')}/requests.json`;
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!res.ok) {
      return { delivered: false, dryRun: false, request, status: res.status, error: `Open311 responded ${res.status}` };
    }
    // GeoReport v2 returns an array (possibly of length 1) of request objects.
    const parsed = (await res.json()) as Array<{ service_request_id?: string; service_notice?: string }>;
    const first = Array.isArray(parsed) ? parsed[0] : undefined;
    if (!first?.service_request_id) {
      return {
        delivered: false,
        dryRun: false,
        request,
        status: res.status,
        error: 'Open311 response had no service_request_id',
      };
    }
    return {
      delivered: true,
      dryRun: false,
      request,
      serviceRequestId: first.service_request_id,
      status: res.status,
    };
  } catch (err) {
    return { delivered: false, dryRun: false, request, error: err instanceof Error ? err.message : 'hand-off failed' };
  }
}

export interface Open311StatusResult {
  dryRun: boolean;
  /** The provider's raw status string (`open` | `closed` | ...), when one was fetched. */
  status?: string;
  note?: string;
  error?: string;
}

/**
 * Poll Open311 for the current status of a submitted request via
 * `GET /requests/{service_request_id}.json`. Like `submitOpen311Request`, it
 * DEGRADES GRACEFULLY: with no endpoint configured it returns a dry-run
 * result (no network), and it never throws. The returned `status` is the raw
 * Open311 value ("open"/"closed") and, like the GOGov adapter, is normalized
 * by the shared, provider-neutral `mapExternalStatus` (`lifecycle.ts`).
 */
export async function fetchOpen311Status(
  serviceRequestId: string,
  config: Open311Config,
  fetchImpl: typeof fetch = fetch,
): Promise<Open311StatusResult> {
  if (!config.endpoint) return { dryRun: true };
  try {
    const params = new URLSearchParams();
    if (config.jurisdictionId) params.set('jurisdiction_id', config.jurisdictionId);
    if (config.apiKey) params.set('api_key', config.apiKey);
    const qs = params.toString();
    const url =
      `${config.endpoint.replace(/\/$/, '')}/requests/${encodeURIComponent(serviceRequestId)}.json` +
      (qs ? `?${qs}` : '');
    const res = await fetchImpl(url, { headers: { accept: 'application/json' } });
    if (!res.ok) return { dryRun: false, error: `Open311 status responded ${res.status}` };
    const parsed = (await res.json()) as Array<{ status?: string; status_notes?: string }>;
    const first = Array.isArray(parsed) ? parsed[0] : undefined;
    if (!first?.status) return { dryRun: false, error: 'Open311 status response had no status' };
    return { dryRun: false, status: first.status, note: first.status_notes };
  } catch (err) {
    return { dryRun: false, error: err instanceof Error ? err.message : 'status poll failed' };
  }
}
