/**
 * The public-dashboard-wide "Demo data" banner (issue #111): a visitor to the
 * read-only public map has no source file to consult, so the app must tell
 * them directly when scripts/seed.ts fiction is mixed into the feed — and
 * must NOT show that banner when every hazard in the feed is a real report,
 * or outside public-dashboard mode.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '../i18n-render.tsx';
import { _resetDbForTests } from '../../src/lib/db.ts';
import { checkA11y } from '../axe.ts';
import type { Hazard } from '../../shared/types.ts';

vi.mock('../../src/components/MapView.tsx', () => ({
  MapView: () => <div data-testid="map-stub">map</div>,
}));

const NOW = 1_700_000_000_000;

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
    createdAt: NOW - 5000,
    updatedAt: NOW - 5000,
    expiresAt: NOW + 1_000_000,
    ...over,
  };
}

function mockFeed(hazards: Hazard[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ hazards }) }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('App demo-data banner — public-dashboard mode', () => {
  beforeEach(async () => {
    await _resetDbForTests();
    vi.doMock('../../src/config.ts', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../../src/config.ts')>();
      return { config: { ...actual.config, publicDashboard: true } };
    });
  });

  it('shows the banner when a seeded hazard is in the feed, with no a11y violations', async () => {
    mockFeed([hazard({ id: 'seed-1', source: 'seed' }), hazard({ id: 'real-1', source: 'report' })]);
    const { default: App } = await import('../../src/App.tsx');
    const { container } = render(<App />);
    await waitFor(() =>
      expect(screen.getByText(/includes illustrative demo hazards/i)).toBeInTheDocument(),
    );
    await checkA11y(container);
  });

  it('does NOT show the banner when every hazard is a real report', async () => {
    mockFeed([hazard({ id: 'real-1', source: 'report' }), hazard({ id: 'real-2' })]);
    const { default: App } = await import('../../src/App.tsx');
    render(<App />);
    await screen.findByTestId('map-stub');
    expect(screen.queryByText(/includes illustrative demo hazards/i)).toBeNull();
  });
});

describe('App demo-data banner — private/dev mode', () => {
  beforeEach(async () => {
    await _resetDbForTests();
    vi.doMock('../../src/config.ts', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../../src/config.ts')>();
      return { config: { ...actual.config, publicDashboard: false } };
    });
  });

  it('does not show the public-dashboard demo banner even with seeded data present', async () => {
    mockFeed([hazard({ id: 'seed-1', source: 'seed' })]);
    const { default: App } = await import('../../src/App.tsx');
    render(<App />);
    await screen.findByTestId('map-stub');
    expect(screen.queryByText(/includes illustrative demo hazards/i)).toBeNull();
  });
});
