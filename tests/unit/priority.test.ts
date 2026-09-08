/**
 * The city prioritisation export (issue #179).
 *
 * The three properties under test are the ones that make the export safe to
 * hand a city, and each of them is a shape this portfolio has published wrongly
 * before:
 *
 *  - a 311 reference printed for a hand-off that never left the process;
 *  - an area with no exposure estimate scored as if it had been measured;
 *  - a caveat that quietly stops matching the document it quotes.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  EQUITY_LIMITS_NOTE,
  EXPOSURE_CAVEAT,
  PRIORITY_COLUMNS,
  buildPriorityRows,
  isExportable,
  priorityPreamble,
  toPriorityCsv,
  toPriorityGeoJson,
} from '../../server/lib/priority.ts';
import type { StoredHazard } from '../../server/lib/types.ts';
import type { HandoffDelivery } from '../../server/lib/types.ts';
import type { HazardCategory, Severity } from '../../shared/types.ts';

const NOW = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

/**
 * Read a repo file, resolved from the working directory (the repo root, where
 * vitest runs). NOT via `new URL(..., import.meta.url)`: the jsdom environment
 * this suite runs under replaces the global `URL`, which resolves a relative
 * path against `http://localhost:3000/` rather than the module's `file:` URL,
 * and the resulting read silently missed both documents. `readFileSync` throws
 * ENOENT on a wrong path, so a broken lookup fails the gate rather than
 * reporting an empty document that contains no note and passes nothing.
 */
const repoFile = (relative: string) => readFileSync(resolve(process.cwd(), relative), 'utf8');

/**
 * Both quoted sentences are line-wrapped in their source documents, and the
 * one in `shared/areas.ts` also carries a ` * ` block-comment prefix on every
 * continuation line. Compare on collapsed whitespace so the gate tracks the
 * WORDING rather than the fill column: rewording either sentence still fails,
 * reflowing a paragraph does not.
 */
const flatten = (text: string) =>
  text
    .replace(/^\s*\*\s?/gm, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** UC Davis campus: exposureWeight 5. */
const CAMPUS = { lat: 38.5375, lng: -121.7575 };
/** South Davis: exposureWeight 2. */
const SOUTH = { lat: 38.52, lng: -121.75 };
/** Inside DAVIS_BOUNDS but outside every named box → "Elsewhere in Davis". */
const ELSEWHERE = { lat: 38.575, lng: -121.69 };

interface HazardOverrides {
  id?: string;
  category?: HazardCategory;
  severity?: Severity;
  confirmations?: number;
  status?: StoredHazard['status'];
  createdAt?: number;
  location?: { lat: number; lng: number };
  handoff?: StoredHazard['handoff'];
  handoffDelivery?: HandoffDelivery | null;
}

function hazard(overrides: HazardOverrides = {}): StoredHazard {
  const location = overrides.location ?? CAMPUS;
  return {
    id: overrides.id ?? 'h1',
    clientId: `client-${overrides.id ?? 'h1'}`,
    category: overrides.category ?? 'pothole',
    severity: overrides.severity ?? 'moderate',
    description: 'A hazard',
    preciseLocation: location,
    // Deliberately a DIFFERENT point from the precise one, so a test that
    // expects precise coordinates cannot pass on the fuzzed value by accident.
    publicLocation: { lat: location.lat + 0.01, lng: location.lng + 0.01 },
    photo: null,
    status: overrides.status ?? 'approved',
    confirmations: overrides.confirmations ?? 1,
    createdAt: overrides.createdAt ?? NOW - 10 * DAY,
    updatedAt: NOW - DAY,
    expiresAt: NOW + 10 * DAY,
    resolvedAt: null,
    handoff: overrides.handoff ?? null,
    handoffDelivery: overrides.handoffDelivery ?? null,
    osmNote: null,
    moderation: [],
    source: 'report',
  };
}

const handoffRecord = {
  provider: 'gogov',
  reference: 'REF-123',
  externalStatus: 'new',
  stage: 'submitted' as const,
  submittedAt: NOW - 5 * DAY,
  updatedAt: NOW - 5 * DAY,
};

/** A complete delivery receipt, so no field is left to a cast. */
function receipt(state: HandoffDelivery['state'], dryRun: boolean): HandoffDelivery {
  return {
    state,
    dryRun,
    attempts: 1,
    lastAttemptAt: NOW - 5 * DAY,
    nextRetryAt: state === 'retrying' ? NOW + DAY : null,
    lastError: state === 'retrying' || state === 'failed' ? 'connect ECONNREFUSED' : null,
  };
}

describe('isExportable', () => {
  it('takes confirmed hazards and nothing else', () => {
    expect(isExportable(hazard({ confirmations: 1 }))).toBe(true);
    // Reported-only: approved but nobody has corroborated it.
    expect(isExportable(hazard({ confirmations: 0 }))).toBe(false);
    expect(isExportable(hazard({ status: 'pending' }))).toBe(false);
    expect(isExportable(hazard({ status: 'rejected' }))).toBe(false);
    expect(isExportable(hazard({ status: 'resolved' }))).toBe(false);
    expect(isExportable(hazard({ status: 'expired' }))).toBe(false);
  });

  it('lists every confirmed hazard exactly once', () => {
    const rows = buildPriorityRows(
      [
        hazard({ id: 'a' }),
        hazard({ id: 'b', location: SOUTH }),
        hazard({ id: 'c', confirmations: 0 }),
        hazard({ id: 'd', status: 'pending' }),
      ],
      NOW,
    );
    expect(rows.map((r) => r.hazardId).sort()).toEqual(['a', 'b']);
    expect(new Set(rows.map((r) => r.hazardId)).size).toBe(rows.length);
  });
});

describe('the 311 reference is only printed where something was delivered', () => {
  it('prints it for a delivered hand-off', () => {
    const [row] = buildPriorityRows(
      [hazard({ handoff: handoffRecord, handoffDelivery: receipt('submitted', false) })],
      NOW,
    );
    expect(row.handoffDelivery).toBe('delivered');
    expect(row.handoffReference).toBe('REF-123');
  });

  it.each([
    ['dry_run', receipt('submitted', true)],
    ['undelivered', receipt('failed', false)],
    ['undelivered', receipt('retrying', false)],
  ])('blanks it for a %s hand-off, and says which', (kind, delivery) => {
    const [row] = buildPriorityRows(
      [hazard({ handoff: handoffRecord, handoffDelivery: delivery })],
      NOW,
    );
    // The hand-off's own stage still reads "submitted" — that is the trap.
    expect(row.handoffStage).toBe('submitted');
    expect(row.handoffDelivery).toBe(kind);
    expect(row.handoffReference).toBeNull();
  });

  it('blanks it when a hand-off exists with no receipt at all', () => {
    const [row] = buildPriorityRows(
      [hazard({ handoff: handoffRecord, handoffDelivery: null })],
      NOW,
    );
    expect(row.handoffDelivery).toBe('unknown');
    expect(row.handoffReference).toBeNull();
  });

  it("says 'none' rather than 'unknown' when no hand-off was ever attempted", () => {
    const [row] = buildPriorityRows([hazard()], NOW);
    expect(row.handoffDelivery).toBe('none');
    expect(row.handoffReference).toBeNull();
    expect(row.handoffProvider).toBeNull();
    expect(row.handoffStage).toBeNull();
  });
});

describe('an area with no exposure estimate is not scored as if it had one', () => {
  it('leaves weight, per-exposure and rank blank for Elsewhere in Davis', () => {
    const rows = buildPriorityRows(
      [hazard({ id: 'a', location: CAMPUS }), hazard({ id: 'b', location: ELSEWHERE })],
      NOW,
    );
    const elsewhere = rows.find((r) => r.hazardId === 'b');
    expect(elsewhere?.area).toBe('Elsewhere in Davis');
    expect(elsewhere?.areaExposureWeight).toBeNull();
    expect(elsewhere?.areaConfirmedPerExposure).toBeNull();
    expect(elsewhere?.areaRank).toBeNull();
    // The raw count is still real and still reported.
    expect(elsewhere?.areaConfirmedCount).toBe(1);
  });

  it('sorts unranked rows after every ranked row, however small the ranked score', () => {
    // South Davis: 1 hazard / weight 2 = 0.5 — the lowest possible non-zero
    // per-exposure figure here. Elsewhere has 4 hazards and no weight. If the
    // absent weight were defaulted to 1, Elsewhere would score 4.0 and sort
    // FIRST; if the absent rank were read as 0, it would sort as a measurement.
    const rows = buildPriorityRows(
      [
        hazard({ id: 'south', location: SOUTH }),
        hazard({ id: 'e1', location: ELSEWHERE }),
        hazard({ id: 'e2', location: ELSEWHERE }),
        hazard({ id: 'e3', location: ELSEWHERE }),
        hazard({ id: 'e4', location: ELSEWHERE }),
      ],
      NOW,
    );
    expect(rows[0].hazardId).toBe('south');
    expect(rows[0].areaRank).toBe(1);
    expect(rows.slice(1).every((r) => r.areaRank === null)).toBe(true);
  });

  it('ranks named areas by hazards per unit of exposure, not by raw count', () => {
    // Campus: 3 hazards / weight 5 = 0.6. South: 2 hazards / weight 2 = 1.0.
    // By raw count campus would lead; normalised, South Davis does.
    const rows = buildPriorityRows(
      [
        hazard({ id: 'c1', location: CAMPUS }),
        hazard({ id: 'c2', location: CAMPUS }),
        hazard({ id: 'c3', location: CAMPUS }),
        hazard({ id: 's1', location: SOUTH }),
        hazard({ id: 's2', location: SOUTH }),
      ],
      NOW,
    );
    const south = rows.filter((r) => r.area === 'South Davis');
    const campus = rows.filter((r) => r.area === 'UC Davis campus');
    expect(south[0].areaRank).toBe(1);
    expect(south[0].areaConfirmedPerExposure).toBe(1);
    expect(campus[0].areaRank).toBe(2);
    expect(campus[0].areaConfirmedPerExposure).toBe(0.6);
    expect(campus[0].areaConfirmedCount).toBe(3);
    expect(rows.slice(0, 2).every((r) => r.area === 'South Davis')).toBe(true);
  });
});

describe('the order is deterministic and total', () => {
  it('breaks ties by severity, confirmations, days open, then id', () => {
    const rows = buildPriorityRows(
      [
        hazard({ id: 'zz', severity: 'low', confirmations: 1 }),
        hazard({ id: 'aa', severity: 'low', confirmations: 1 }),
        hazard({ id: 'mid', severity: 'moderate', confirmations: 1 }),
        hazard({ id: 'high-old', severity: 'high', confirmations: 1, createdAt: NOW - 30 * DAY }),
        hazard({ id: 'high-new', severity: 'high', confirmations: 1, createdAt: NOW - 2 * DAY }),
        hazard({ id: 'high-many', severity: 'high', confirmations: 4 }),
      ],
      NOW,
    );
    expect(rows.map((r) => r.hazardId)).toEqual([
      'high-many',
      'high-old',
      'high-new',
      'mid',
      'aa',
      'zz',
    ]);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('produces identical output for a shuffled input', () => {
    const hazards = [
      hazard({ id: 'a', location: CAMPUS }),
      hazard({ id: 'b', location: SOUTH, severity: 'high' }),
      hazard({ id: 'c', location: ELSEWHERE }),
      hazard({ id: 'd', location: SOUTH }),
    ];
    const forwards = toPriorityCsv(buildPriorityRows(hazards, NOW), NOW);
    const backwards = toPriorityCsv(buildPriorityRows([...hazards].reverse(), NOW), NOW);
    expect(forwards).toBe(backwards);
  });

  it('returns an empty row set, not an error, when nothing is confirmed', () => {
    expect(buildPriorityRows([], NOW)).toEqual([]);
    expect(buildPriorityRows([hazard({ confirmations: 0 })], NOW)).toEqual([]);
  });
});

describe('the rendered formats', () => {
  it('writes a blank CSV cell for a null, never a zero or the word null', () => {
    const csv = toPriorityCsv(buildPriorityRows([hazard({ location: ELSEWHERE })], NOW), NOW);
    const lines = csv.trim().split('\n');
    const header = lines.find((l) => l.startsWith('rank,'));
    const row = lines[lines.length - 1];
    expect(header).toBe(PRIORITY_COLUMNS.join(','));
    const cells = row.split(',');
    const at = (name: string) => cells[PRIORITY_COLUMNS.indexOf(name as never)];
    expect(at('area_exposure_weight')).toBe('');
    expect(at('area_confirmed_per_exposure')).toBe('');
    expect(at('area_rank')).toBe('');
    expect(at('handoff_reference')).toBe('');
    expect(row).not.toMatch(/\bnull\b/);
    expect(at('handoff_delivery')).toBe('none');
  });

  it('quotes a value containing a comma so the row cannot split', () => {
    const csv = toPriorityCsv(buildPriorityRows([hazard({ location: ELSEWHERE })], NOW), NOW);
    // "Elsewhere in Davis" has no comma; assert the escaper itself on one that does.
    const withComma = toPriorityCsv(
      buildPriorityRows([hazard({ id: 'a,b' })], NOW),
      NOW,
    );
    expect(withComma).toContain('"a,b"');
    expect(csv.split('\n').filter((l) => !l.startsWith('#') && l).length).toBe(2);
  });

  it('carries the precise location, not the fuzzed one', () => {
    const h = hazard({ location: CAMPUS });
    const [row] = buildPriorityRows([h], NOW);
    expect(row.lat).toBe(h.preciseLocation.lat);
    expect(row.lng).toBe(h.preciseLocation.lng);
    expect(row.lat).not.toBe(h.publicLocation.lat);
    const geo = toPriorityGeoJson([row], NOW);
    expect(geo.features[0].geometry.coordinates).toEqual([
      h.preciseLocation.lng,
      h.preciseLocation.lat,
    ]);
  });

  it('gives the GeoJSON the same columns and the same values as the CSV', () => {
    const rows = buildPriorityRows([hazard({ location: ELSEWHERE })], NOW);
    const geo = toPriorityGeoJson(rows, NOW);
    expect(Object.keys(geo.features[0].properties)).toEqual([...PRIORITY_COLUMNS]);
    expect(geo.features[0].properties.area_rank).toBeNull();
    expect(geo.notes).toEqual(priorityPreamble(NOW));
  });
});

describe('the preamble quotes its sources verbatim', () => {
  it('reproduces the coverage-equity limits note exactly as the audit states it', () => {
    expect(flatten(repoFile('docs/audits/coverage-equity.md'))).toContain(
      flatten(EQUITY_LIMITS_NOTE),
    );
    expect(priorityPreamble(NOW).join('\n')).toContain(EQUITY_LIMITS_NOTE);
  });

  it('reproduces the exposure caveat exactly as shared/areas.ts states it', () => {
    expect(flatten(repoFile('shared/areas.ts'))).toContain(flatten(EXPOSURE_CAVEAT));
    expect(priorityPreamble(NOW).join('\n')).toContain(EXPOSURE_CAVEAT);
  });

  it('states the normalisation basis and that a blank is not a zero', () => {
    const text = priorityPreamble(NOW).join('\n');
    expect(text).toContain('area_confirmed_count /');
    expect(text).toContain('Blank cells are not zeros');
    expect(text).toContain('handoff_reference is blank unless handoff_delivery is "delivered"');
  });

  it('says disputes are absent rather than shipping a column of zeros', () => {
    expect(priorityPreamble(NOW).join('\n')).toContain('Dispute counts are not included');
    expect(PRIORITY_COLUMNS).not.toContain('disputes' as never);
  });
});
