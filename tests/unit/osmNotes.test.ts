import { describe, it, expect, vi } from 'vitest';
import {
  buildOsmNotePayload,
  postOsmNote,
  isOsmEligible,
  OSM_ELIGIBLE_CATEGORIES,
  type OsmNotesConfig,
} from '../../server/lib/osmNotes.ts';
import type { StoredHazard } from '../../server/lib/types.ts';

/**
 * The deployment name used by every case here is deliberately **not** Davis and
 * not the shipped pack's.
 *
 * The defect this file now guards against was a Davis literal in the note body.
 * A fixture that asked for "Davis Bike Hazard Map" would be satisfied by that
 * literal, so it could never tell the fix from the bug — the same shape as
 * asserting a translation with a fixture the English path also answers.
 */
const TEST_DEPLOYMENT_NAME = 'Woodland Bike Hazard Map';

function cfg(over: Partial<OsmNotesConfig> = {}): OsmNotesConfig {
  return { enabled: false, deploymentName: TEST_DEPLOYMENT_NAME, ...over };
}

function stored(over: Partial<StoredHazard> = {}): StoredHazard {
  return {
    id: 'haz-1',
    clientId: 'c1',
    category: 'dangerous_intersection',
    severity: 'high',
    description: 'Cars run the light and there is broken glass everywhere',
    preciseLocation: { lat: 38.5449, lng: -121.7405 },
    publicLocation: { lat: 38.545, lng: -121.74 },
    photo: null,
    status: 'approved',
    source: 'report',
    confirmations: 0,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    expiresAt: 1_800_000_000_000,
    moderation: [],
    ...over,
  };
}

describe('OSM_ELIGIBLE_CATEGORIES', () => {
  it('covers only permanent-infrastructure categories', () => {
    expect(OSM_ELIGIBLE_CATEGORIES).toEqual(['dangerous_intersection', 'poor_visibility']);
    expect(isOsmEligible('dangerous_intersection')).toBe(true);
    expect(isOsmEligible('poor_visibility')).toBe(true);
    expect(isOsmEligible('pothole')).toBe(false);
  });
});

describe('buildOsmNotePayload', () => {
  it('uses the FUZZED public location, not the precise one', () => {
    const payload = buildOsmNotePayload(stored(), cfg());
    // publicLocation projected to OSM's lat/lon field names.
    expect(payload.lat).toBe(38.545);
    expect(payload.lon).toBe(-121.74);
    // Never the precise device coordinate.
    expect(payload.lat).not.toBe(38.5449);
    expect(payload.lon).not.toBe(-121.7405);
  });

  it('includes category + severity labels and permanent-infrastructure wording', () => {
    const payload = buildOsmNotePayload(stored(), cfg());
    expect(payload.text).toContain('Dangerous intersection');
    expect(payload.text).toContain('High');
    expect(payload.text).toContain('permanent infrastructure');
  });

  it('never leaks description, photo, or reporter data', () => {
    const payload = buildOsmNotePayload(
      stored({ description: 'SECRET-REPORTER-TEXT', clientId: 'SECRET-CLIENT' }),
      cfg(),
    );
    expect(payload.text).not.toContain('SECRET-REPORTER-TEXT');
    expect(payload.text).not.toContain('SECRET-CLIENT');
    expect(payload.text).not.toContain('glass');
    expect(JSON.stringify(payload)).not.toContain('SECRET');
  });

  it('references the hazard id and uses a full back-link when a base URL is configured', () => {
    const idOnly = buildOsmNotePayload(stored(), cfg());
    expect(idOnly.text).toContain('haz-1');

    const linked = buildOsmNotePayload(stored(), cfg({ publicBaseUrl: 'https://hazards.example/' }));
    expect(linked.text).toContain('https://hazards.example/#hazard=haz-1');
  });
});

/**
 * The note body names the deployment that sent it, and that name is the one
 * string in this system that becomes somebody else's permanent public data. OSM
 * notes cannot be retracted by redeploying, so a second town publishing under
 * Davis's name is not a cosmetic error.
 */
describe('the note names the deployment that sent it, from the pack', () => {
  it('uses the configured name in the body', () => {
    const { text } = buildOsmNotePayload(stored(), cfg());
    expect(text).toContain(`via the ${TEST_DEPLOYMENT_NAME}`);
  });

  it('uses the configured name in the id-only back-link too', () => {
    // Both branches: the back-link without a public base URL repeats the name,
    // and it was the second Davis literal in the previous implementation.
    const { text } = buildOsmNotePayload(stored(), cfg());
    expect(text).toContain(`${TEST_DEPLOYMENT_NAME} reference haz-1`);
  });

  it('carries no other deployment name than the configured one', () => {
    // Presence first, then absence: an absence assertion alone would be
    // satisfied by a body that named nobody at all.
    const { text } = buildOsmNotePayload(stored(), cfg());
    expect(text).toContain(TEST_DEPLOYMENT_NAME);
    expect(text).not.toContain('Davis');
  });

  it('names the deployment when a public base URL is configured as well', () => {
    const { text } = buildOsmNotePayload(
      stored(),
      cfg({ publicBaseUrl: 'https://hazards.example/' }),
    );
    expect(text).toContain('https://hazards.example/#hazard=haz-1');
    expect(text).toContain(TEST_DEPLOYMENT_NAME);
    expect(text).not.toContain('Davis');
  });

  it('refuses to draft an unattributable note rather than posting one', () => {
    // A blank name is unreachable from a loaded pack (`z.string().min(1)`), and
    // reachable from a hand-assembled config. Refusing beats emitting a note a
    // moderator would be asked to post to OpenStreetMap over no sender at all.
    expect(() => buildOsmNotePayload(stored(), cfg({ deploymentName: '   ' }))).toThrow(
      /deploymentName is blank/,
    );
  });
});

describe('postOsmNote', () => {
  it('dry-runs (no network) when the feature is disabled', async () => {
    const fetchMock = vi.fn();
    const result = await postOsmNote(
      stored(),
      cfg({ apiUrl: 'https://api.openstreetmap.org/api/0.6/notes' }),
      fetchMock,
    );
    expect(result.dryRun).toBe(true);
    expect(result.delivered).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('dry-runs when enabled but no apiUrl is configured', async () => {
    const fetchMock = vi.fn();
    const result = await postOsmNote(stored(), cfg({ enabled: true, apiUrl: '' }), fetchMock);
    expect(result.dryRun).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POSTs form-encoded lat/lon/text and reports delivery on 2xx', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response);
    const result = await postOsmNote(
      stored(),
      cfg({ enabled: true, apiUrl: 'https://osm.example/notes' }),
      fetchMock,
    );
    expect(result.delivered).toBe(true);
    expect(result.dryRun).toBe(false);
    expect(result.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://osm.example/notes');
    expect((init as RequestInit).method).toBe('POST');
    const body = (init as RequestInit).body as URLSearchParams;
    expect(body).toBeInstanceOf(URLSearchParams);
    expect(body.get('lat')).toBe('38.545');
    expect(body.get('lon')).toBe('-121.74');
    expect(body.get('text')).toContain('Dangerous intersection');
  });

  it('reports a non-2xx as undelivered', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 429 } as Response);
    const result = await postOsmNote(
      stored(),
      cfg({ enabled: true, apiUrl: 'https://osm.example/notes' }),
      fetchMock,
    );
    expect(result.delivered).toBe(false);
    expect(result.error).toContain('429');
  });

  it('degrades gracefully (never throws) when the request rejects', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('connreset'));
    const result = await postOsmNote(
      stored(),
      cfg({ enabled: true, apiUrl: 'https://osm.example/notes' }),
      fetchMock,
    );
    expect(result.delivered).toBe(false);
    expect(result.error).toContain('connreset');
  });
});
