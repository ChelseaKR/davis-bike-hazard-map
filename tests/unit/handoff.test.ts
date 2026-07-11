import { describe, it, expect, vi } from 'vitest';
import { forwardHandoff, syncHandoffStatus, type HandoffProviderConfig } from '../../server/lib/handoff.ts';
import type { StoredHazard } from '../../server/lib/types.ts';

function stored(): StoredHazard {
  return {
    id: 'haz-1',
    clientId: 'c1',
    category: 'pothole',
    severity: 'high',
    description: 'Deep pothole',
    preciseLocation: { lat: 38.5449, lng: -121.7405 },
    publicLocation: { lat: 38.545, lng: -121.74 },
    photo: null,
    status: 'approved',
    confirmations: 0,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    expiresAt: 1_800_000_000_000,
    moderation: [],
  };
}

function config(overrides: Partial<HandoffProviderConfig> = {}): HandoffProviderConfig {
  return {
    handoffProvider: 'gogov',
    gogov: { webhookUrl: '', apiKey: '' },
    open311: { endpoint: '', serviceCode: 'bike-hazard' },
    ...overrides,
  };
}

describe('forwardHandoff', () => {
  it('defaults to GOGov and references the hazard id', async () => {
    const result = await forwardHandoff(stored(), config(), vi.fn());
    expect(result.provider).toBe('gogov');
    expect(result.reference).toBe('haz-1');
    expect(result.dryRun).toBe(true);
  });

  it('routes to Open311 when configured and uses the returned service_request_id as the reference', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => [{ service_request_id: '638344' }],
    } as Response);
    const result = await forwardHandoff(
      stored(),
      config({ handoffProvider: 'open311', open311: { endpoint: 'https://311.example.gov/v2', serviceCode: 'bike-hazard' } }),
      fetchMock,
    );
    expect(result.provider).toBe('open311');
    expect(result.reference).toBe('638344');
    expect(result.delivered).toBe(true);
  });

  it('falls back to the hazard id as the reference for an Open311 dry-run', async () => {
    const result = await forwardHandoff(
      stored(),
      config({ handoffProvider: 'open311' }),
      vi.fn(),
    );
    expect(result.provider).toBe('open311');
    expect(result.reference).toBe('haz-1');
    expect(result.dryRun).toBe(true);
  });
});

describe('syncHandoffStatus', () => {
  it('polls GOGov when the hazard was handed off via gogov, ignoring the currently configured provider', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'In Progress' }),
    } as Response);
    const result = await syncHandoffStatus(
      'gogov',
      'haz-1',
      config({ handoffProvider: 'open311', gogov: { webhookUrl: '', apiKey: '', statusUrl: 'https://311.example/status' } }),
      fetchMock,
    );
    expect(result.status).toBe('In Progress');
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain('/status/haz-1');
  });

  it('polls Open311 when the hazard was handed off via open311', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ status: 'closed' }],
    } as Response);
    const result = await syncHandoffStatus(
      'open311',
      '638344',
      config({ open311: { endpoint: 'https://311.example.gov/v2', serviceCode: 'bike-hazard' } }),
      fetchMock,
    );
    expect(result.status).toBe('closed');
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain('/requests/638344.json');
  });
});
