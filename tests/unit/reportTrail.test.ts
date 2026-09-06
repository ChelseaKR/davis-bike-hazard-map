import { describe, it, expect } from 'vitest';
import { createIntl, type IntlShape } from 'react-intl';
import { reportTrail, reportStageLabel } from '../../src/lib/reportTrail.ts';
import type { Hazard, HandoffDeliveryKind, PublicHandoffInfo } from '../../shared/types.ts';

// English `defaultMessage`s — used where a test is about the trail's SHAPE and
// the wording is incidental.
const intl: IntlShape = createIntl({ locale: 'en', defaultLocale: 'en', messages: {} });

/**
 * A catalog of sentinels, one per message id this module should be using.
 *
 * Issue #164: these strings were bare English literals in `src/lib`, invisible
 * to both halves of the G2 gate — `no-literal-string-in-jsx` because they are
 * not in JSX, and `formatjs extract` because they were not behind a
 * `defineMessages`/`formatMessage` node. A test that matched them by English
 * regex could not tell the difference. Formatting under a catalog whose values
 * are sentinels can: a literal that never reaches the catalog comes back as
 * English and fails.
 */
const SENTINELS = {
  'report.trail.reported.label': '⟦reported⟧',
  'report.trail.reported.detail': '⟦reported.detail⟧',
  'report.trail.reviewed.label': '⟦reviewed⟧',
  'report.trail.inReview.label': '⟦inReview⟧',
  'report.trail.inReview.detail': '⟦inReview.detail⟧',
  'report.trail.rejected.label': '⟦rejected⟧',
  'report.trail.rejected.detail': '⟦rejected.detail⟧',
  'report.trail.onMap.label': '⟦onMap⟧',
  'report.trail.onMap.detail': '⟦onMap.detail⟧',
  'report.trail.city.sent.label': '⟦city.sent⟧',
  'report.trail.city.notSent.label': '⟦city.notSent⟧',
  'report.trail.city.notSent.detail': '⟦city.notSent.detail⟧',
  'report.trail.city.sending.label': '⟦city.sending⟧',
  'report.trail.city.sending.detail': '⟦city.sending.detail⟧',
  'report.trail.city.unknown.detail': '⟦city.unknown.detail⟧',
  'report.trail.fixed.label': '⟦fixed⟧',
  'report.trail.fixed.detail': '⟦fixed.detail⟧',
  'report.trail.expired.label': '⟦expired⟧',
  'report.trail.expired.detail': '⟦expired.detail⟧',
  'report.stage.confirmed': '⟦stage.confirmed⟧',
  'hazard.handoff.in_progress': '⟦handoff.in_progress⟧',
  'hazard.handoff.resolved': '⟦handoff.resolved⟧',
} as const;
const localized: IntlShape = createIntl({
  locale: 'en',
  defaultLocale: 'en',
  messages: SENTINELS,
  onError: () => {},
});

function hazard(over: Partial<Hazard> = {}): Hazard {
  return {
    id: 'h1',
    category: 'pothole',
    severity: 'high',
    description: null,
    location: { lat: 38.545, lng: -121.74 },
    photoUrl: null,
    status: 'pending',
    confirmations: 0,
    createdAt: 0,
    updatedAt: 0,
    expiresAt: 0,
    handoff: null,
    ...over,
  };
}

const handoff = (
  stage: PublicHandoffInfo['stage'],
  delivery: HandoffDeliveryKind = 'delivered',
): PublicHandoffInfo => ({
  provider: 'gogov',
  reference: 'h1',
  externalStatus: stage,
  stage,
  delivery,
  submittedAt: 0,
  updatedAt: 0,
  note: null,
});

const labelOf = (h: Hazard, key: string) => reportTrail(h, intl).find((s) => s.key === key)?.label;
const detailOf = (h: Hazard, key: string) => reportTrail(h, intl).find((s) => s.key === key)?.detail;

const keys = (h: Hazard) => reportTrail(h, intl).map((s) => s.key);
const stateOf = (h: Hazard, key: string) => reportTrail(h, intl).find((s) => s.key === key)?.state;

describe('reportTrail', () => {
  it('a pending report is reported → in review → (on the map upcoming)', () => {
    const h = hazard({ status: 'pending' });
    expect(keys(h)).toEqual(['reported', 'review', 'onmap']);
    expect(stateOf(h, 'reported')).toBe('done');
    expect(stateOf(h, 'review')).toBe('current');
    expect(stateOf(h, 'onmap')).toBe('upcoming');
  });

  it('an approved report (no hand-off) is current on the map', () => {
    const h = hazard({ status: 'approved' });
    expect(stateOf(h, 'review')).toBe('done');
    expect(stateOf(h, 'onmap')).toBe('current');
  });

  it('a rejected report short-circuits to a terminal "not approved" step', () => {
    const h = hazard({ status: 'rejected' });
    expect(keys(h)).toEqual(['reported', 'review', 'rejected']);
    expect(stateOf(h, 'rejected')).toBe('rejected');
  });

  it('adds a city step once handed off, current until the city resolves it', () => {
    const h = hazard({ status: 'approved', handoff: handoff('in_progress') });
    expect(keys(h)).toContain('city');
    expect(stateOf(h, 'onmap')).toBe('done');
    expect(stateOf(h, 'city')).toBe('current');
  });

  it('marks the whole trail done when resolved (with the city step done)', () => {
    const h = hazard({ status: 'resolved', handoff: handoff('resolved'), resolvedAt: 5 });
    expect(keys(h)).toEqual(['reported', 'review', 'onmap', 'city', 'fixed']);
    expect(stateOf(h, 'city')).toBe('done');
    expect(stateOf(h, 'fixed')).toBe('done');
  });

  // Issue #162: `handoff.stage` reads 'submitted' from the moment a forward is
  // ATTEMPTED, dry-run or not, so the trail used to tell a reporter their report
  // had reached the city when nothing had left the server.
  it('does not claim a dry-run hand-off reached the city', () => {
    const h = hazard({ status: 'approved', handoff: handoff('submitted', 'dry_run') });
    expect(labelOf(h, 'city')).not.toMatch(/^sent to city/i);
    expect(labelOf(h, 'city')).toMatch(/not sent/i);
    // Nothing has happened, so the step is not "in progress" either.
    expect(stateOf(h, 'city')).toBe('upcoming');
    expect(detailOf(h, 'city')).toMatch(/no 311 connection/i);
  });

  it('does not claim a failed hand-off reached the city', () => {
    const h = hazard({ status: 'approved', handoff: handoff('submitted', 'undelivered') });
    expect(labelOf(h, 'city')).not.toMatch(/^sent to city/i);
    expect(stateOf(h, 'city')).toBe('current');
    expect(detailOf(h, 'city')).toMatch(/hasn't succeeded/i);
  });

  it('does not present an unrecorded delivery as a completed one', () => {
    const h = hazard({ status: 'approved', handoff: handoff('submitted', 'unknown') });
    expect(detailOf(h, 'city')).toMatch(/not recorded/i);
  });

  it('a delivered hand-off still reads as sent, with the city stage as the detail', () => {
    const h = hazard({ status: 'approved', handoff: handoff('in_progress', 'delivered') });
    expect(labelOf(h, 'city')).toMatch(/^sent to city/i);
    expect(detailOf(h, 'city')).toBe('City crew assigned');
  });

  it('shows an expired tail when the report ages off the map', () => {
    const h = hazard({ status: 'expired' });
    expect(keys(h)).toContain('expired');
    expect(stateOf(h, 'expired')).toBe('done');
  });
});

// Issue #164: these used to assert the English copy by regex, which passes
// identically whether the string comes from the catalog or from a bare literal.
// Asserting against a sentinel catalog tests the routing instead of the wording.
describe('reportStageLabel', () => {
  it('picks the right message id for each moderation/lifecycle state', () => {
    expect(reportStageLabel(hazard({ status: 'pending' }), localized)).toBe('⟦inReview⟧');
    expect(reportStageLabel(hazard({ status: 'rejected' }), localized)).toBe('⟦rejected⟧');
    expect(reportStageLabel(hazard({ status: 'approved', confirmations: 0 }), localized)).toBe(
      '⟦onMap⟧',
    );
    expect(reportStageLabel(hazard({ status: 'approved', confirmations: 2 }), localized)).toBe(
      '⟦stage.confirmed⟧',
    );
  });
});

describe('the trail is translatable end to end (issue #164)', () => {
  const localizedTrail = (h: Hazard) =>
    reportTrail(h, localized).flatMap((s) => [s.label, s.detail].filter(Boolean) as string[]);

  it('renders no English literal for any state the trail can reach', () => {
    const hazards: Hazard[] = [
      hazard({ status: 'pending' }),
      hazard({ status: 'rejected' }),
      hazard({ status: 'approved', confirmations: 3 }),
      hazard({ status: 'approved', handoff: handoff('submitted', 'dry_run') }),
      hazard({ status: 'approved', handoff: handoff('submitted', 'undelivered') }),
      hazard({ status: 'approved', handoff: handoff('submitted', 'unknown') }),
      hazard({ status: 'approved', handoff: handoff('in_progress', 'delivered') }),
      hazard({ status: 'resolved', handoff: handoff('resolved'), resolvedAt: 5 }),
      hazard({ status: 'expired' }),
    ];
    const rendered = hazards.flatMap(localizedTrail);
    expect(rendered.length).toBeGreaterThan(15);
    const sentinels = new Set<string>(Object.values(SENTINELS));
    // The plural detail interpolates a count, so match the sentinel loosely.
    const escaped = rendered.filter(
      (v) => !sentinels.has(v) && ![...sentinels].some((s) => v.includes(s)),
    );
    expect(escaped).toEqual([]);
  });

  it('routes the delivered hand-off detail through the shared handoff catalog, not the raw enum labels', () => {
    const h = hazard({ status: 'approved', handoff: handoff('in_progress', 'delivered') });
    // `hazard.handoff.in_progress` is the id `src/i18n/labels.ts` already
    // defined; this module used to import the untranslatable
    // `HANDOFF_STAGE_LABELS` from shared/types.ts instead.
    expect(reportTrail(h, localized).find((s) => s.key === 'city')?.detail).toBe(
      '⟦handoff.in_progress⟧',
    );
  });
});
