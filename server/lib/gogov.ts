/**
 * Optional 311 / GOGov hand-off adapter.
 *
 * Davis's GOGov/311 has no documented free public submission API, so this is an
 * adapter with a clear contract that DEGRADES GRACEFULLY: with no webhook
 * configured it runs in "dry-run" and returns the payload it *would* have sent,
 * so the rest of the system (and tests) work without a live integration. Least
 * privilege: only the fields 311 needs are forwarded; the photo and precise
 * location go only with the report, never broadcast.
 */
import type { StoredHazard } from './types.ts';
import { CATEGORY_LABELS, SEVERITY_LABELS } from '../../shared/types.ts';

export interface GogovConfig {
  webhookUrl: string;
  apiKey: string;
  /** Optional status-poll endpoint (GET {statusUrl}/{reference}). */
  statusUrl?: string;
}

/** The exact contract we forward to 311. Documented and minimal. */
export interface GogovPayload {
  source: 'davis-bike-hazard-map';
  category: string;
  severity: string;
  description: string;
  location: { lat: number; lng: number };
  reportedAt: string;
  reference: string;
}

export interface GogovResult {
  delivered: boolean;
  dryRun: boolean;
  payload: GogovPayload;
  status?: number;
  error?: string;
}

export function buildPayload(hazard: StoredHazard): GogovPayload {
  return {
    source: 'davis-bike-hazard-map',
    category: CATEGORY_LABELS[hazard.category],
    severity: SEVERITY_LABELS[hazard.severity],
    description:
      hazard.description ??
      `${CATEGORY_LABELS[hazard.category]} reported by a cyclist.`,
    // 311 needs the actual spot to dispatch a crew, so this hand-off uses the
    // precise location (the user opted into the hand-off by triggering it).
    location: hazard.preciseLocation,
    reportedAt: new Date(hazard.createdAt).toISOString(),
    reference: hazard.id,
  };
}

/**
 * Forward a hazard to 311. With no webhook configured, returns a dry-run result
 * describing the payload. Never throws — a failed hand-off must not break the
 * app (graceful degradation, ROADMAP §6).
 */
export async function forwardToGogov(
  hazard: StoredHazard,
  config: GogovConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<GogovResult> {
  const payload = buildPayload(hazard);

  if (!config.webhookUrl) {
    return { delivered: false, dryRun: true, payload };
  }

  try {
    const res = await fetchImpl(config.webhookUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify(payload),
    });
    return {
      delivered: res.ok,
      dryRun: false,
      payload,
      status: res.status,
      error: res.ok ? undefined : `311 responded ${res.status}`,
    };
  } catch (err) {
    return {
      delivered: false,
      dryRun: false,
      payload,
      error: err instanceof Error ? err.message : 'hand-off failed',
    };
  }
}

export interface GogovStatusResult {
  dryRun: boolean;
  /** The provider's raw status string, when one was fetched. */
  status?: string;
  note?: string;
  error?: string;
}

/**
 * Poll 311 for the current status of a forwarded report. Like the hand-off
 * itself, it DEGRADES GRACEFULLY: with no status URL configured it returns a
 * dry-run result (no network), and it never throws.
 */
export async function fetchGogovStatus(
  reference: string,
  config: GogovConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<GogovStatusResult> {
  if (!config.statusUrl) return { dryRun: true };
  try {
    const url = `${config.statusUrl.replace(/\/$/, '')}/${encodeURIComponent(reference)}`;
    const res = await fetchImpl(url, {
      headers: {
        accept: 'application/json',
        ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
      },
    });
    if (!res.ok) return { dryRun: false, error: `311 status responded ${res.status}` };
    const body = (await res.json()) as { status?: string; note?: string };
    if (!body.status) return { dryRun: false, error: '311 status response had no status' };
    return { dryRun: false, status: body.status, note: body.note };
  } catch (err) {
    return { dryRun: false, error: err instanceof Error ? err.message : 'status poll failed' };
  }
}
