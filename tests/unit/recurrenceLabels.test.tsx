/**
 * Recurrence labels on the list card and in the map popup (issue #180): one
 * sentence from one state, "reported", never "happened"; never on seeded demo
 * data; and a failure to load them that says so, where "not published" says
 * nothing at all.
 */
import { describe, it, expect } from 'vitest';
import { createIntl } from 'react-intl';
import { render, screen } from '../i18n-render.tsx';
import { HazardCard } from '../../src/components/HazardCard.tsx';
import { ListView } from '../../src/components/ListView.tsx';
import { MapDataNotice, buildPopup } from '../../src/components/MapView.tsx';
import { DEFAULT_LOCALE, loadMessages } from '../../src/i18n/config.ts';
import { monthLabel } from '../../src/i18n/labels.ts';
import type { RecurrenceState } from '../../src/hooks/useRecurrence.ts';
import type { Hazard } from '../../shared/types.ts';
import type { RecurrenceBadge } from '../../shared/recurrence.ts';

const intl = createIntl({
  locale: DEFAULT_LOCALE,
  defaultLocale: DEFAULT_LOCALE,
  messages: loadMessages(DEFAULT_LOCALE),
});

const BADGE: RecurrenceBadge = { hazardId: 'h1', episodes: 3, since: '2026-01' };
const SENTENCE = 'Reported here in 3 separate episodes since January 2026.';

function hazard(over: Partial<Hazard> = {}): Hazard {
  return {
    id: 'h1',
    category: 'pothole',
    severity: 'high',
    description: 'Deep pothole',
    location: { lat: 38.5449, lng: -121.7405 },
    photoUrl: null,
    status: 'approved',
    confirmations: 0,
    createdAt: 1,
    updatedAt: 1,
    expiresAt: Number.MAX_SAFE_INTEGER,
    source: 'report',
    ...over,
  };
}

const published = (badges: RecurrenceBadge[]): RecurrenceState => ({
  status: 'published',
  badges: new Map(badges.map((b) => [b.hazardId, b])),
});

describe('the label sentence', () => {
  it('says reported, never happened', () => {
    expect(SENTENCE).toMatch(/^Reported here/);
    expect(SENTENCE).not.toMatch(/happen|occur|incident/i);
  });

  it("formats a month key in the town's calendar, whatever the viewer's offset", () => {
    expect(monthLabel(intl, '2026-01')).toBe('January 2026');
    expect(monthLabel(intl, '2026-12')).toBe('December 2026');
  });
});

describe('HazardCard and the map popup', () => {
  it('print the identical sentence for the same label', () => {
    render(
      <ul>
        <HazardCard hazard={hazard()} recurrence={BADGE} />
      </ul>,
    );
    const onCard = screen.getByText(SENTENCE);
    const popup = buildPopup(hazard(), intl, undefined, undefined, BADGE);
    expect(popup.querySelector('.map-popup-recurrence')?.textContent).toBe(onCard.textContent);
  });

  it('print nothing for a hazard with no label', () => {
    render(
      <ul>
        <HazardCard hazard={hazard()} />
      </ul>,
    );
    expect(screen.queryByText(/separate episode/)).toBeNull();
    expect(buildPopup(hazard(), intl).querySelector('.map-popup-recurrence')).toBeNull();
  });

  it('never label a seeded demo hazard, even when handed a label', () => {
    render(
      <ul>
        <HazardCard hazard={hazard({ source: 'seed' })} recurrence={BADGE} />
      </ul>,
    );
    expect(screen.queryByText(/separate episode/)).toBeNull();
    const popup = buildPopup(hazard({ source: 'seed' }), intl, undefined, undefined, BADGE);
    expect(popup.querySelector('.map-popup-recurrence')).toBeNull();
  });
});

describe('ListView', () => {
  const two = [hazard({ id: 'h1' }), hazard({ id: 'h2', category: 'glass_debris' })];

  it("gives each card its own label, and none to a card whose site does not recur", () => {
    render(<ListView hazards={two} loading={false} error={null} recurrence={published([BADGE])} />);
    expect(screen.getAllByText(SENTENCE)).toHaveLength(1);
    const card = screen.getByText(SENTENCE).closest('li');
    expect(card?.textContent).toMatch(/Pothole/);
  });

  it('says labels could not be loaded when they could not', () => {
    render(<ListView hazards={two} loading={false} error={null} recurrence={{ status: 'unavailable' }} />);
    expect(screen.getByText(/Labels for recurring reports could not be loaded/)).toBeInTheDocument();
    expect(screen.queryByText(/separate episode/)).toBeNull();
  });

  it.each([
    ['not published', { status: 'unpublished' } as RecurrenceState],
    ['still loading', { status: 'loading' } as RecurrenceState],
  ])('says nothing about labels that are %s', (_why, state) => {
    render(<ListView hazards={two} loading={false} error={null} recurrence={state} />);
    expect(screen.queryByText(/Labels for recurring reports/)).toBeNull();
    expect(screen.queryByText(/separate episode/)).toBeNull();
  });
});

describe('MapDataNotice', () => {
  it('says labels could not be loaded, as the list does', () => {
    render(<MapDataNotice feedError={null} recurrenceUnavailable />);
    expect(screen.getByText(/Labels for recurring reports could not be loaded/)).toBeInTheDocument();
  });

  it('says nothing about labels by default', () => {
    render(<MapDataNotice feedError={null} />);
    expect(screen.queryByText(/Labels for recurring reports/)).toBeNull();
  });
});
